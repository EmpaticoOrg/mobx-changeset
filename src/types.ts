import {ValidatorResult} from 'mobx-changeset-validations';

export interface Dict<T> {
  [key: string]: T;
}

//Use the default react-intl fromat for now
export type ValidationMessageDescriptor = {} | undefined

export interface SyncValidator {
  (key: string, newValue: any, model?: any): ValidatorResult;
}

export interface AsyncValidator {
  (key: string, newValue: any, model?: any): Promise<ValidatorResult>;
  async: true;
}

export type Validator = SyncValidator | AsyncValidator;

export type ValidationMessageGenerator = (type: string, key: string, context: Dict<any>) => ValidationMessageDescriptor;

export function isAsyncValidator(validator: Validator): validator is AsyncValidator {
  if ((validator as AsyncValidator).async) {
    return true;
  }

  return false;
}
