// 简版响应式更新实现
// 有很多硬编码
// 缺少合理的副作用函数注册机制

// 副作用函数容器
const effectsBuckets = new Set<Function>()

const originData = {
  text: 'Hello Vue',
}

const proxyData = new Proxy(originData, {
  // 拦截读取操作
  get(target, key) {
    // 添加副作用函数
    effectsBuckets.add(effect)
    return target[key]
  },
  // 拦截设置操作
  set(target, key, newVal) {
    target[key] = newVal
    // 遍历调用副作用函数
    effectsBuckets.forEach((fn) => fn())
    return true
  },
})

function effect() {
  document.title = proxyData.text
}

effect()

console.log(document.title)

setTimeout(() => {
  proxyData.text = 'Hello Vue3!'
  console.log(document.title)
}, 2000)

export {}
