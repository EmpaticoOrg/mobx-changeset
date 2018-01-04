/**
 * Like `Array.prototype.reduce` but promise aware. Runs a promise-returning callback serially over an array of values.
 */

interface ReductionCallback<V> {
  (accumulator: V, currentValue: any, currentIndex: number, arr: any[]): Promise<V>;
}

export default function promiseReduce<V>(cb: ReductionCallback<V>, initialValue: V) {

  return function(val: any[]): Promise<V> {

    const length = val.length;

    if (length === 0) {
      return Promise.resolve(initialValue);
    }

    return val.reduce(function (promise, curr, index, arr) {
      return promise.then(function (prev: V) {
        if (prev === undefined && length === 1) {
          return curr;
        }

        return cb(prev, curr, index, arr);
      });
    }, Promise.resolve(initialValue));
  };
}
