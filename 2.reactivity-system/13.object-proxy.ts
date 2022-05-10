// 对对象代理的详细实现
// 处理 for in 操作
// 处理 delete 操作

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

export const originData = {
  count: 1,
  foo: 2,
  bar: 3,
  get reflect() {
    return this.foo
  },
}

const enum TriggerType {
  add = 'add',
  set = 'set',
  delete = 'delete',
}

const ITERATE_KEY = Symbol('iterate')

export const proxyData = new Proxy(originData, {
  //! ownKeys用于拦截for...in循环中的对象属性读取操作，包括新增和修改
  ownKeys(target) {
    // 将副作用函数与ITERATE_KEY进行关联
    track(target, ITERATE_KEY)

    return Reflect.ownKeys(target)
  },
  //! deleteProperty用于拦截对象的delete操作
  deleteProperty(target, key) {
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
    track(target, key)

    return Reflect.get(target, key, receiver)
  },
  // 拦截设置操作
  set(target, key, newVal, receiver) {
    // 先获取旧值，便于后面比较
    const oldValue = target[key]

    //! 判断是新增属性还是修改属性
    const type = Object.prototype.hasOwnProperty.call(target, key)
      ? TriggerType.set
      : TriggerType.add

    const res = Reflect.set(target, key, newVal, receiver)

    //! 前面全等判断，后面进行NaN判断
    if (oldValue !== newVal && (oldValue === oldValue || newVal === newVal)) {
      trigger(target, key, type)
    }

    return res
  },
})

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

  //! 只有在新增或者删除类型时才需要触发，避免不必要的性能损耗
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

// 都能代理到
effect(() => {
  for (const key in proxyData) {
    console.log(key)
  }
})

delete proxyData.foo

export {}
