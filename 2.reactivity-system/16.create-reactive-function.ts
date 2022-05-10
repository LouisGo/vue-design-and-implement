// 之前写的reactive函数都是浅响应（shallow reactive）
// 因为只代理了外面一层，里面的对象都是普通对象
// 解决办法非常简单，就是递归
// 最好的办法是把核心逻辑收拢在一个createReactive函数，同事创建两个工具函数来根据需要返回深浅响应的对象
// 同时基于createReactive，可以提供只读和浅只读的功能

// 副作用函数容器
const effectsBuckets = new WeakMap<
  object,
  Map<string | Symbol, Set<EffectFn>>
>()

interface EffectFnOptions {
  scheduler?: (fn: () => void) => void
  lazy?: boolean
}

interface EffectFn {
  (): void
  deps: Set<EffectFn>[]
  options?: EffectFnOptions
}

// 全局变量用于当前活动的副作用函数
let activeEffect: EffectFn = null
// effect栈
const effectStack: EffectFn[] = []

// 专门由effect函数进行副作用收集
export function effect(fn, options: EffectFnOptions = {}) {
  const effectFn: EffectFn = () => {
    // 先清除之前的副作用
    cleanup(effectFn)
    // 注册fn时将当前activeEffect指向fn
    activeEffect = effectFn
    // 压栈
    effectStack.push(effectFn)
    // 执行fn，用res接受
    const res = fn()
    // 出栈
    effectStack.pop()
    // 当前活动副作用指向正确位置
    activeEffect = effectStack[effectStack.length - 1]
    // 将res返回
    return res
  }
  effectFn.deps = []
  effectFn.options = options
  // 如果不是懒执行，跟以前一样立即执行
  if (!options?.lazy) {
    effectFn()
  }
  // 否则返回一个getter函数
  return effectFn
}

export function cleanup(effectFn: EffectFn) {
  // 遍历清除副作用
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  // 重置
  effectFn.deps.length = 0
}

const enum TriggerType {
  add = 'add',
  set = 'set',
  delete = 'delete',
}

const ITERATE_KEY = Symbol('iterate')

const RAW_KEY = Symbol('raw')

// 核心逻辑在createReactive函数，新增两个参数
// isShallow用来判断是否是浅响应
// isReadonly用来判断是否是只读
function createReactive<T extends object>(
  target: T,
  isShallow = false,
  isReadonly = false
): T {
  return new Proxy(target, {
    // ownKeys用于拦截for...in循环中的对象属性读取操作，包括新增和修改
    ownKeys(target) {
      // 将副作用函数与ITERATE_KEY进行关联
      track(target, ITERATE_KEY)

      return Reflect.ownKeys(target)
    },
    // deleteProperty用于拦截对象的delete操作
    deleteProperty(target, key) {
      //! 如果是只读属性，则给出警告直接返回
      if (isReadonly) {
        console.warn('set failed: readonly')
        return true
      }

      // 检查是否是自有属性
      const hadKey = Object.prototype.hasOwnProperty.call(target, key)

      const res = Reflect.deleteProperty(target, key)

      // 只有当被删除的属性是自有属性并且成功删除时，才会触发更新
      if (res && hadKey) {
        trigger(target, key, TriggerType.delete)
      }

      return res
    },
    // 拦截读取操作
    get(target, key, receiver) {
      // 增加一个RAW_KEY，用于访问原始对象
      if (key === RAW_KEY) {
        return target
      }

      // 非只读的时候才需要建立响应式联系
      if (!isReadonly) {
        track(target, key)
      }

      //! 用res缓存getter结果
      const res = Reflect.get(target, key, receiver)

      //! 如果是浅响应则跟之前一样直接返回
      if (isShallow) {
        return res
      }

      //! 如果res结果是一个对象，且不等于null，则进行递归操作
      if (typeof res === 'object' && res !== null) {
        //! 如果数据为只读（且非浅只读），则调用readonly函数进行包装，否则调用reactive
        return isReadonly ? readonly(res) : reactive(res)
      }

      return res
    },
    // 拦截设置操作
    set(target, key, newVal, receiver) {
      //! 如果是只读属性，则给出警告直接返回
      if (isReadonly) {
        console.warn('set failed: readonly')
        return true
      }

      // 先获取旧值，便于后面比较
      const oldValue = target[key]

      // 判断是新增属性还是修改属性
      const type = Object.prototype.hasOwnProperty.call(target, key)
        ? TriggerType.set
        : TriggerType.add

      const res = Reflect.set(target, key, newVal, receiver)

      // 只有target等于receiver的原始对象（通过getter里面的特殊返回值判断）时，才需要进行trigger
      if (target === receiver[RAW_KEY]) {
        // 前面全等判断，后面进行NaN判断
        if (
          oldValue !== newVal &&
          (oldValue === oldValue || newVal === newVal)
        ) {
          trigger(target, key, type)
        }
      }

      return res
    },
  })
}

//! 深响应函数
export function reactive<T extends object>(target: T): T {
  return createReactive(target)
}

//! 浅响应函数
export function shallowReactive<T extends object>(target: T): T {
  return createReactive(target, true)
}

//! 深只读函数
export function readonly<T extends object>(target: T): T {
  return createReactive(target, false, true)
}

//! 浅只读函数
export function shallowReadonly<T extends object>(target: T): T {
  return createReactive(target, true, true)
}

export function track(target, key) {
  if (!activeEffect) return target[key]

  let depsMap = effectsBuckets.get(target)

  if (!depsMap) {
    effectsBuckets.set(target, (depsMap = new Map()))
  }

  let deps = depsMap.get(key)

  if (!deps) {
    depsMap.set(key, (deps = new Set()))
  }

  deps.add(activeEffect)

  // 在deps中保存所有deps
  activeEffect.deps.push(deps)
}

export function trigger(target, key, type: TriggerType = TriggerType.add) {
  const depsMap = effectsBuckets.get(target)

  if (!depsMap) return

  const effects = depsMap.get(key)

  // 避免forEach中操作原来的Set
  // 从而导致一边cleanup进行delete，一边进行add触发无限循环
  // 因而重新构造一个新的Set
  const effectsToRun = new Set<EffectFn>()

  effects?.forEach((fn) => {
    // 避免track和trigger是引用同一个函数引发的无限循环问题
    if (fn !== activeEffect) {
      effectsToRun.add(fn)
    }
  })

  // 只有在新增或者删除类型时才需要触发，避免不必要的性能损耗
  if (type === TriggerType.add || type === TriggerType.delete) {
    // 取得与ITERATE_KEY关联的副作用函数
    const iterateEffects = depsMap.get(ITERATE_KEY)

    // 将与ITERATE_KEY关联的副作用函数加入effectsToRun
    iterateEffects?.forEach((fn) => {
      if (fn !== activeEffect) {
        effectsToRun.add(fn)
      }
    })
  }

  effectsToRun?.forEach((fn) => {
    if (fn?.options?.scheduler) {
      fn.options.scheduler(fn)
    } else {
      fn()
    }
  })
}

const originChild = {}

const originParent = {
  bar: 1,
  foo: {
    aaa: 5,
  },
}

const proxyChild = reactive(originChild)

const proxyParent = reactive(originParent)

const demoReadonly = readonly(proxyParent)

const demoShallowReadonly = shallowReadonly(proxyParent)

demoShallowReadonly.bar = 3 // set failed: readonly

demoReadonly.foo.aaa = 10 // set failed: readonly

//! 使用proxyParent作为proxyChild的原型
Object.setPrototypeOf(proxyChild, proxyParent)

// rerender demo
effect(() => {
  // before: 1, 2, 2
  // after: 1, 2
  console.log((proxyChild as any).bar)
})

// 跟之前表现一致
// @ts-ignore
proxyChild.bar++ // before: 引发2次相同的副作用函数

export {}
