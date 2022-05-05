// 因为computed惰性执行的缘故，此时在effect中的computed值是不会被计算的
// 其实就是另类的effect嵌套问题，只不过内部的effect(getter)是惰性的因此不会被正确触发
// 因此在执行getter时，需要手动track追踪
// 在依赖的星影视数据变化时，也要手动trigger触发更新

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
function effect(fn, options: EffectFnOptions = {}) {
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

function cleanup(effectFn: EffectFn) {
  // 遍历清除副作用
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  // 重置
  effectFn.deps.length = 0
}

const originData = {
  count: 1,
  foo: 2,
  bar: 3,
}

const proxyData = new Proxy(originData, {
  // 拦截读取操作
  get(target, key) {
    track(target, key)

    return target[key]
  },
  // 拦截设置操作
  set(target, key, newVal) {
    target[key] = newVal

    trigger(target, key)

    return true
  },
})

function track(target, key) {
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

function trigger(target, key) {
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

  effectsToRun?.forEach((fn) => {
    if (fn?.options?.scheduler) {
      fn.options.scheduler(fn)
    } else {
      fn()
    }
  })
}

// computed初步实现
function computed(getter) {
  // 缓存计算值
  let cacheValue: any
  // 是否需要重新计算
  let dirty = true

  const effectFn = effect(getter, {
    lazy: true,
    // 用来调度执行依赖数据变更时的dirty状态
    scheduler() {
      dirty = true
      //! 此时说明依赖数据发生了变更，需要手动触发
      trigger(proxyData, 'value')
    },
  })
  const obj = {
    // 用xxx.value的形式触发getter
    get value() {
      if (dirty) {
        cacheValue = effectFn()
        // 标记为不需要重新计算
        dirty = false
        console.log('get new value')
      } else {
        console.log('get cache value')
      }
      //! 读取时，需要手动追踪依赖
      track(proxyData, 'value')
      return cacheValue
    },
  }
  return obj
}

const sum = computed(() => proxyData.foo + proxyData.bar)

effect(() => {
  console.log(`[effect] sum changed to: ${sum.value}`)
})

console.log(sum.value)

proxyData.foo++

console.log(sum.value)

console.log(sum.value)

export {}
