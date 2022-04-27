// 更完善的响应式更新实现
// 不再硬编码effect副作用函数
// 利用effect的回调进行注册
// 副作用函数容器的数据结构变更 Set => WeakMap
// track和trigger函数封装

// 副作用函数容器
const effectsBuckets = new WeakMap<
  object,
  Map<string | Symbol, Set<Function>>
>()

// 全局变量用于当前活动的副作用函数
let activeEffect = null

// 专门由effect函数进行副作用收集
function effect(fn) {
  // 注册fn时将当前activeEffect指向fn
  activeEffect = fn
  // 执行fn
  fn()
}

const originData = {
  text: 'Hello Vue',
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
}

function trigger(target, key) {
  const depsMap = effectsBuckets.get(target)

  if (!depsMap) return

  const effects = depsMap.get(key)

  effects?.forEach((fn) => fn?.())
}

// 注册副作用函数
effect(() => {
  document.title = proxyData.text
})

console.log(document.title)

// 注册副作用函数
effect(() => {
  console.log('hahaha its changed!')
})

setTimeout(() => {
  proxyData.text = 'Hello Vue3!'
  console.log(document.title)
}, 2000)

export {}
