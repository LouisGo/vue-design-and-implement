// 利用schedule构建一个简易的批量更新effect

// 副作用函数容器
const effectsBuckets = new WeakMap<
  object,
  Map<string | Symbol, Set<EffectFn>>
>()

interface EffectFn {
  (): void
  deps: Set<EffectFn>[]
  options?: {
    scheduler?: (fn: () => void) => void
  }
}

// 全局变量用于当前活动的副作用函数
let activeEffect: EffectFn = null
// effect栈
const effectStack: EffectFn[] = []

// 专门由effect函数进行副作用收集
function effect(fn, options = {}) {
  const effectFn: EffectFn = () => {
    // 先清除之前的副作用
    cleanup(effectFn)
    // 注册fn时将当前activeEffect指向fn
    activeEffect = effectFn
    // 压栈
    effectStack.push(effectFn)
    // 执行fn
    fn()
    // 出栈
    effectStack.pop()
    // 当前活动副作用指向正确位置
    activeEffect = effectStack[effectStack.length - 1]
  }
  effectFn.deps = []
  effectFn.options = options
  effectFn()
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

const jobQueue = new Set<() => void>()

// 用微任务的方式进行调度
const p = Promise.resolve()

let isFlushing = false

function flushJob() {
  if (isFlushing) return

  isFlushing = true

  p.then(() => {
    jobQueue.forEach((job) => job())
  }).finally(() => {
    isFlushing = false
  })
}

effect(
  () => {
    console.log(proxyData.count)
  },
  {
    scheduler(fn) {
      jobQueue.add(fn)
      flushJob()
    },
  }
)

proxyData.count++
proxyData.count++

export {}
