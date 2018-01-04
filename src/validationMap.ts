import {Validator} from './types';
import {FailedValidation} from '../../mobx-validations/src'
import promiseReduce from './promiseReduce';

export type ValidationMap<M> = {
  [P in keyof M]?: Validator | Validator[];
};

export type ValidationResult<M> = {
  [P in keyof M]?: true | FailedValidation;
};

export async function runValidations<M>(model: M, validations: ValidationMap<M>): Promise<ValidationResult<M>> {
  const reducer = promiseReduce<ValidationResult<M>>(async function (accu, key) {
    let validators = validations[key];

    if (!validators) {
      return accu;
    }

    if (typeof validators === 'function') {
      validators = [validators];
    }

    for (const validator of validators) {

      try {
        accu[key] = await validator(key, model[key], model);
      } catch (e) {
        // bubble actual exceptions - not failed validations - up the promise chain
        throw e;
      }

      // break on first validation failure for this property
      if (accu[key] !== true) {
        break;
      }
    }

    return accu;
  }, {} as ValidationResult<M>);

  return Promise.resolve(Object.keys(model)).then(reducer);
}
