type ErrorHandler = (error: any) => void;

let errorHandler: ErrorHandler | null = null;

const demoUtils = {
  foo(fn: Function) {
    console.log('foo');
    callWithErrorHandling(fn);
  },
  bar(fn: Function) {
    console.log('bar');
    callWithErrorHandling(fn);
  },
  registerErrorHandler(fn: ErrorHandler) {
    errorHandler = fn;
  },
};

export default demoUtils;

/** 执行函数之前调用统一错误处理函数进行try-catch处理 */
function callWithErrorHandling(fn) {
  try {
    return fn?.();
  } catch (error) {
    errorHandler(error);
  }
}

/** 注册自定义错误处理回调函数 */
demoUtils.registerErrorHandler((error) => {
  console.log('error handler executed!');
  console.log(error);
});

demoUtils.foo(() => {
  throw new Error('foo error');
});

demoUtils.bar(() => {
  throw new Error('bar error');
});
