// js中数组是一种特殊的对象（异质对象）
// 跟普通对象相比，只有[[DefineOwnProperty]]这个内部方法的实现不同
// 因此大部分代理普通对象的操作可以直接使用，比如arr[0] = 'xxx'
// 但是依然存在一些数组跟普通对象不同的操作方式
//

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
      //! 如果目标是数组，则使用length属性作为key建立联系，用于for-in和for-of循环的track
      track(target, Array.isArray(target) ? 'length' : ITERATE_KEY)

      return Reflect.ownKeys(target)
    },
    // deleteProperty用于拦截对象的delete操作
    deleteProperty(target, key) {
      // 如果是只读属性，则给出警告直接返回
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
      //! 新增key为symbol的判断，因为当调用对象的迭代器时会读取Symbol.iterator属性，不应该追踪这个值
      if (!isReadonly && typeof key !== 'symbol') {
        track(target, key)
      }

      // 用res缓存getter结果
      const res = Reflect.get(target, key, receiver)

      // 如果是浅响应则跟之前一样直接返回
      if (isShallow) {
        return res
      }

      // 如果res结果是一个对象，且不等于null，则进行递归操作
      if (typeof res === 'object' && res !== null) {
        // 如果数据为只读（且非浅只读），则调用readonly函数进行包装，否则调用reactive
        return isReadonly ? readonly(res) : reactive(res)
      }

      return res
    },
    // 拦截设置操作
    set(target, key, newVal, receiver) {
      // 如果是只读属性，则给出警告直接返回
      if (isReadonly) {
        console.warn('set failed: readonly')
        return true
      }

      // 先获取旧值，便于后面比较
      const oldValue = target[key]

      // 判断是新增属性还是修改属性
      //! 新增数组判断逻辑
      const type = Array.isArray(target)
        ? Number(key) < target.length // 判断数值是新增还是修改操作
          ? TriggerType.set
          : TriggerType.add
        : Object.prototype.hasOwnProperty.call(target, key)
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
          //! 新增newVal参数，用于后续trigger的判断
          trigger(target, key, type, newVal)
        }
      }

      return res
    },
  })
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

export function trigger(
  target,
  key,
  type: TriggerType = TriggerType.add,
  newVal?
) {
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

  const isArrayTarget = Array.isArray(target)

  //! 当操作类型为新增并且目标对象是数组时，应该收集便于后续执行与length有关的副作用函数
  if (isArrayTarget && type === TriggerType.add) {
    const lengthEffects = depsMap.get('length')

    lengthEffects?.forEach((fn) => {
      if (fn !== activeEffect) {
        effectsToRun.add(fn)
      }
    })
  }

  //! 如果操作的key是length，无论哪种类型，都需要收集便于后续执行索引值大于等于length的副作用函数
  if (isArrayTarget && key === 'length') {
    // 对于索引大于或者等于新length值的元素
    // 需要把所有相关联的副作用函数去除并添加执行
    depsMap.forEach((effects, key) => {
      if (key >= newVal) {
        effects.forEach((fn) => {
          if (fn !== activeEffect) {
            effectsToRun.add(fn)
          }
        })
      }
    })
  }

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

// 深响应函数
export function reactive<T extends object>(target: T): T {
  return createReactive(target)
}

// 浅响应函数
export function shallowReactive<T extends object>(target: T): T {
  return createReactive(target, true)
}

// 深只读函数
export function readonly<T extends object>(target: T): T {
  return createReactive(target, false, true)
}

// 浅只读函数
export function shallowReadonly<T extends object>(target: T): T {
  return createReactive(target, true, true)
}

const arr = reactive([1, 2, 3])

effect(() => {
  console.log(arr.length)
})

effect(() => {
  for (const key in arr) {
    console.log(key, ':', arr[key])
  }
})

arr[4] = 100

arr.length = 0

export {}
