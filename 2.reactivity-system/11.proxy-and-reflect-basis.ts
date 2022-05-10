// Proxy 可以创建一个【代理对象】
// 代理指的对一个对象【基本语义】的代理
// 它允许【拦截】并【重新定义】一个对象的【基本操作】

// 基本语义，如：
const obj = {
  foo: 0,
  fn: () => {},
  get bar() {
    return this.foo
  },
}

obj.foo // 读取属性
obj.foo++ // 读取和设置属性

// 这种属性值的读取和设置是可以被Proxy代理的，属于【基本操作】
// 第一个参数obj：被代理的原始对象
// 第二个参数trap对象：用来设置读取和设置属性的拦截器
const p1 = new Proxy(obj, {
  get() {},
  // @ts-ignore
  set() {},
})

// 函数也是一个对象，也可以被Proxy代理，也属于【基本操作】
// apply可以用来拦截函数的调用
const fn = (name) => {
  console.log('I am', name)
}

const p2 = new Proxy(fn, {
  apply(target, thisArg, argArray) {
    // 处理调用逻辑
    target.call(thisArg, ...argArray)
  },
})

p2('Louis') // I am Louis

// 以上都是基本操作，Proxy可以用来代理这些操作
// 但如下是不行的
obj.fn()
// 因为这里调用对象的方法属性，属于【复合操作】
// 实际拆分成了两个基本操作，即先通过get操作拿到obj.fn，再通过apply操作调用fn

// Reflect是一个全局对象，它提供了一系列的方法，用来访问和修改对象的属性
// 下属的方法跟Proxy拦截器中的一一对应

console.log(obj.bar) // 1

// 此时跟上面是等价的
console.log(Reflect.get(obj, 'bar')) // 1

// 加上第三个 receiver 对象参数后，读取到的便是receiver的值，有点像call和bind改变this的指向
console.log(Reflect.get(obj, 'bar', { foo: 5 })) // 5
