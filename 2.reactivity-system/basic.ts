// 简版基础响应式更新

// 副作用函数容器
const effects = new Set<Function>()

const originData = {
  text: 'Hello Vue',
}

const proxyData = new Proxy(originData, {
  // 拦截读取操作
  get(target, key) {
    // 添加副作用函数
    effects.add(effect)
    return target[key]
  },
  // 拦截设置操作
  set(target, key, newVal) {
    target[key] = newVal
    // 遍历调用副作用函数
    effects.forEach((fn) => fn())
    return true
  },
})

function effect() {
  document.title = proxyData.text
}

effect()

setTimeout(() => {
  proxyData.text = 'Hello Vue3!'
  console.log(document.title)
}, 2000)

console.log(document.title)
