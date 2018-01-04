import {FailedValidation} from '../../mobx-validations/src'
import capitalize from 'lodash-es/capitalize';
import snakeCase from 'lodash-es/snakeCase';

export function getValidationDescriptor(failedValidation: FailedValidation) {
  let {type, key, message, context} = failedValidation;

  if (typeof message === 'function') {
    return message(type, key, context);
  }

  const descriptor = message ? message : 'messages[type]';

  key = capitalize(snakeCase(key).replace(/_/, ' '));

  return {descriptor, values: {...context, key, type}};
}
