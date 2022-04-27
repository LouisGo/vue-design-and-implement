// effect函数完善
// 通过一个deps数据在trigger时收集副作用函数
// 执行副作用函数之前先清除副作用，避免不必要的副作用
// 处理trigger时的无限循环问题

// 副作用函数容器
const effectsBuckets = new WeakMap<
  object,
  Map<string | Symbol, Set<Function>>
>()

interface EffectFn {
  (): void
  deps: any[]
}

// 全局变量用于当前活动的副作用函数
let activeEffect = null

// 专门由effect函数进行副作用收集
function effect(fn) {
  const effectFn: EffectFn = () => {
    // 先清除之前的副作用
    cleanup(effectFn)
    // 注册fn时将当前activeEffect指向fn
    activeEffect = effectFn
    // 执行fn
    fn()
  }
  effectFn.deps = []
  effectFn()
}

function cleanup(effectFn) {
  // 遍历清除副作用
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  // 重置
  effectFn.deps.length = 0
}

const originData = {
  ok: true,
  text: 'Hello Vue',
  text2: 'text2',
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
  const effectsToRun = new Set(effects)

  effectsToRun?.forEach((fn) => fn?.())
}

// 注册副作用函数
effect(() => {
  console.log('effect!')
  document.title = proxyData.ok ? proxyData.text : 'not'
})

console.log(document.title)

setTimeout(() => {
  proxyData.ok = false
  proxyData.text = 'Hello Vue3'
  console.log(document.title)
}, 2000)

export {}
