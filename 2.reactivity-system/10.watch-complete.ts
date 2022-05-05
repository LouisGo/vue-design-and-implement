// watch的完整实现
// 包括执行时机的配置(immediate)
// 过期副作用的处理(onInvalidate)

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

// watch 函数的实现，目前只处理对象
function watch(
  source,
  cb: (
    newValue: any,
    oldValue: any,
    //! 过期判断回调
    onInvalidate?: (fn) => void
  ) => void,
  //! 新增immdiate参数，表示是否立即执行
  options: {
    immediate?: boolean
  } = {}
) {
  let getter

  // 利用这个特性，可以实现watch的首个参数直接传递一个getter函数
  // 处理getter
  if (typeof source === 'function') {
    getter = source
  } else {
    getter = () => traverse(source)
  }

  // 新旧值
  let oldValue
  let newValue

  // 用来存储用户注册的过期回调
  let cleanup

  function onInvalidate(fn) {
    cleanup = fn
  }

  //! 将原来scheduler内部的完整逻辑封装到job里，方便复用
  const job = () => {
    // 重新执行effect，取得最新值
    newValue = effectFn()

    //! 如果用户注册了过期回调，则执行
    cleanup?.()

    // 将新值和旧值传递给cb
    cb(newValue, oldValue, onInvalidate)

    // 更新旧值
    oldValue = newValue
  }

  const effectFn = effect(() => getter(), {
    scheduler: job,
    // 利用这个特性，获取正确新旧值
    lazy: true,
  })

  if (options.immediate) {
    //! 当immediate为true时，立即执行job，不用等待scheduler
    job()
  } else {
    // 执行effect，取得初始值
    oldValue = effectFn()
  }
}

// 通过traverse函数对source进行遍历，从而正确触发getter
function traverse(source, seen = new Set()) {
  // 如果是原始值
  if (typeof source !== 'object' || source === null) return
  // 如果已经读取过了
  if (seen.has(source)) return

  // 将读取过的对象放入seen
  seen.add(source)

  // 遍历source的所有属性
  for (const key in source) {
    traverse(source[key], seen)
  }

  return source
}

watch(
  proxyData,
  (newValue, oldValue) => {
    console.log('watched data.bar changed', newValue, oldValue)
  },
  {
    immediate: true,
  }
)

//# region 测试onInvalidate
// 通过expired来处理最终数据的赋值

let finalData = 0

watch(proxyData, async (newValue, oldValue, onInvalidate) => {
  let expired = false

  onInvalidate(() => {
    expired = true
  })

  const res = await fakeFetch()

  if (!expired) {
    finalData = res
    console.log('finalData: ' + finalData)
  } else {
    console.log('expired: ' + finalData)
  }
})

proxyData.bar = 3

let count = 0

// 模拟几次数据变动
setInterval(() => {
  if (count++ < 5) {
    proxyData.bar++
  }
}, 200)

// 模拟飘忽不定的异步请求，永远不知道哪个请求会先到
function fakeFetch(): Promise<number> {
  return new Promise((resolve) => {
    const timeout = Math.floor(Math.random() * 5000)
    setTimeout(() => {
      const random = Math.random() * 1000
      console.log('random: ' + random)
      resolve(random)
    }, timeout)
  })
}

//# endregion

export {}
