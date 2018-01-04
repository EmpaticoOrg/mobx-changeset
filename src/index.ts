import {ValidationMap} from './validationMap';
import {observable, action, ObservableMap, computed, isObservableArray, isObservableMap, toJS, observe, runInAction} from 'mobx';
// import {FieldErrors} from './errors';
import pick from 'lodash-es/pick';
import {Dict, ValidationMessageDescriptor, Validator, isAsyncValidator } from './types';
// import {} from 'mobx-changeset-validations'
import {isPlainObject, ValidatorResult} from 'mobx-changeset-validations';
import {getValidationDescriptor} from './getMessage';

export interface Saver<M> {
  (model: M): Promise<boolean>;
}

function isComplexObject(prop: any) {
  return Array.isArray(prop) ||
    isPlainObject(prop) ||
    isObservableArray(prop) ||
    isObservableMap(prop);
}

export default class Changeset<M extends Dict<any>> {

  protected localValues: ObservableMap<any> = observable.map({}, 'changesetLocalValues');

  protected validations: ValidationMap<M>;
  protected hasAsyncValidator: Dict<true> = {};

  model: Readonly<M>;

  change: {[P in keyof M]: M[P]} = {} as any;
  error: {[P in keyof M]: ValidationMessageDescriptor} = {} as any;

  /**
   * A map of in-progress async validations.
   */
  validating: {[P in keyof M]?: boolean} = {};

  /**
   * Stores the last error that got thrown from a broken async validation
   */
  @observable lastAsyncValidationError: any;

  /**
   * An array of errors that are not applicable to any one property. For example, 500 errors when talking to a server.
   *
   * Takes the form of a string of error codes, which can be of any format and are changeset agnostic.
   */
  @observable genericErrors: string[] = [];

  @computed get genericError() {
    return this.genericErrors.length ? this.genericErrors[0] : undefined;
  }

  @observable isSaving = false;

  @computed get isDirty() {
    return this.dirtyProps.size > 0;
  }

  @observable protected dirtyProps: ObservableMap<boolean> = observable.map({}, 'changeset.DirtyProps');

  @computed get isValidating() {
    return Object.keys(this.validating).some(prop => this.validating[prop] === true);
  }

  @computed get isValid() {
    return !this.isValidating && Object.keys(this.error).some(prop => this.error[prop] !== undefined) === false;
  }

  constructor(model: M , validations: ValidationMap<M>) {

    this.model = model;
    this.validations = validations;

    Object.keys(model).forEach(propName => {
      const origProp = this.model[propName];
      const isComplexProp = isComplexObject(origProp);

      const propValidations = this.validations[propName];
      if (propValidations) {
        const isAsyncValidation = Array.isArray(propValidations)
          ? propValidations.some(isAsyncValidator)
          : isAsyncValidator(propValidations);

        Object.defineProperty(this.error, propName, {
          enumerable: true,
          configurable: true,
          writable: true,

          value: undefined
        });

        if (isAsyncValidation) {
          this.hasAsyncValidator[propName] = true;

          Object.defineProperty(this.validating, propName, {
            enumerable: true,
            configurable: true,
            writable: true,

            value: false
          });
        }
      }

      Object.defineProperty(this.change, propName, {
        enumerable: true,
        configurable: true,

        get: () => {
          // complex properties always proxy through to the copy of the property,
          // to avoid mutating the original object/array/etc
          if (isComplexProp || this.isPropDirty(propName)) {
            return this.localValues.get(propName);
          } else {
            return this.model[propName];
          }
        },

        set: (value: any) => {
          if (isComplexProp) {
            this.createLocalClone(propName, value);
            this.validate(propName);
          } else {
            this.setAndValidate(propName, value);
          }
        }
      });

      if (isComplexProp) {
        this.createLocalClone(propName, origProp);
      }
    });

    this.error = observable.object(this.error, 'Changeset.error');
    this.validating = observable.object(this.validating, 'Changeset.validating');
  }

  @action
  protected createLocalClone(propName: string, prop: any) {
    // create a copy of the observable array or object...
    const observableClone = this.createObservableClone(propName, prop);

    // ... revalidate & mark the changeset dirty when it changes...
    observe(observableClone, () => {
      runInAction(`Validate (complex) ${prop}`, () => {
        this.validate(propName);
        this.dirtyProps.set(propName, true);
      });
    });

    // ... and immediately set the local cache, so we never mutate the original
    this.localValues.set(propName, observableClone);
  }

  protected createObservableClone(propName: string, prop: any) {
    if (Array.isArray(prop)) {
      return observable.array([...prop], `Changeset<${propName}>`);
    } else if (isPlainObject(prop)) {
      return observable.object({...prop}, `Changeset<${propName}>`);
    } else if (isObservableArray(prop)) {
      return observable.array(toJS(prop), `Changeset<${propName}>`);
    } else if (isObservableMap(prop)) {
      return observable.map({}, `Changeset<${propName}>`).merge(prop);
    }
  }

  isPropDirty(prop: string) {
    return this.dirtyProps.has(prop);
  }

  /**
   * Validate a property, or all properties
   */
  validate(prop?: string): boolean | Promise<boolean> {
    let props;

    if (prop) {
      props = [prop];
    } else {
      props = Object.keys(this.model);
    }

    const hasAsync = props.some(p => this.hasAsyncValidator[p]);

    const validations: (void | Promise<void>)[] = [];
    for (const f of props) {
      validations.push(this.validateValue(f, this.change[f]));
    }

    if (hasAsync) {
      return Promise.all(validations).then(() => prop ? this.error[prop] === undefined : this.isValid,
        (e) => this.lastAsyncValidationError = e);

    }

    return prop ? this.error[prop] === undefined : this.isValid;
  }

  /**
   * Validate a property and update the local model with the change
   */
  protected setAndValidate(prop: string, value: any) {
    if (this.isPropDirty(prop) || value !== this.model[prop]) {
      runInAction(`Set "change" for ${prop}`, () => {
        this.localValues.set(prop, value);
        this.dirtyProps.set(prop, true);
      });
    }

    this.validateValue(prop, value);
  }

  /**
   * Validate a specific property and value, using the validations from the validation map for that property
   */
  @action
  protected validateValue(prop: string, value: any) {
    let validators = this.validations[prop];

    if (validators) {
      // convert a single validator into an array for consistency
      if (typeof validators === 'function') {
        validators = [validators];
      }

      if (this.hasAsyncValidator[prop]) {
        return this.validateAsync(validators, prop, value);
      } else {
        return this.validateSync(validators, prop, value);
      }
    }
  }

  @action
  protected validateSync(validators: Validator[], prop: string, value: any) {
    for (const validator of validators) {
      const valid = validator(prop, value, this.change) as ValidatorResult;

      if (valid !== true) {
        this.error[prop] = getValidationDescriptor(valid);
        return;
      }
    }

    this.error[prop] = undefined;
  }

  protected async validateAsync(validators: Validator[], prop: string, value: any) {

    runInAction(`Set "validating" for ${prop}`, () => {
      this.validating[prop] = true;
    });

    for (const validator of validators) {

      try {
        const valid = await validator(prop, value, this.change);

        if (valid !== true) {
          runInAction(`Set "validating" & "error" for ${prop}`, () => {
            this.validating[prop] = false;
            this.error[prop] = getValidationDescriptor(valid);
          });

          return;
        }
      } catch (e) {
        runInAction(`Set "validating" & "lastAsyncValidationError" for ${prop}`, () => {
          this.validating[prop] = false;
          this.lastAsyncValidationError = e;
        });
      }
    }

    runInAction(`Unset "validating" & "error" for ${prop}`, () => {
      this.validating[prop] = false;
      this.error[prop] = undefined;
    });
  }

  /**
   * Testing utility allowing us to pause until all validations have run
   */
  async validationFinished() {
    // @TODO track all validation promises instead of relying on a timer
    return new Promise((resolve) => {
      setInterval(() => {
        if (!this.isValidating) {
          resolve();
        }
      }, 10);
    });
  }

  /**
   * Migrate all local changes onto the model
   */
  @action
  commit() {
    if (this.isValid && this.isDirty) {
      this.localValues.keys().forEach((prop) => {

        const source = this.localValues.get(prop);
        const destination = this.model[prop];

        if (isObservableArray(destination)) {
          destination.replace(source);
        } else if (isObservableMap(destination)) {
          destination.clear();
          destination.merge(source);
        } else {
          // note that this `as any` intentionally contradicts `Readonly<M>`
          (this.model as any)[prop] = source;
        }
      });

      return true;
    }

    return false;
  }

  /**
   * Clear our local changes, reverting back to the current model values
   */
  @action
  reset() {
    this.localValues.clear();

    // re-add any complex object proxies
    Object.keys(this.model)
      .filter(propName => isComplexObject(this.model[propName]))
      .forEach(propName => this.createLocalClone(propName, this.model[propName]));

    this.dirtyProps.clear();
  }

  /**
   * Run a function that saves/persists the model, consistently handling errors if they occur
   */
  @action
  async save(saver: Saver<M>) {
    this.genericErrors = [];

    this.isSaving = true;

    const valid = await this.validate();

    if (!valid) {
      this.isSaving = false;
      return false;
    }
    // even if the changeset is not dirty we want to save, so we continue even if the commit returns false
    this.commit();

    try {
      const saved = await saver(this.model);
      this.isSaving = false;

      // only reset the local changes if the saver has indicated that it worked
      if (saved) {
        this.reset();
      }

      return saved;
    } catch (e) {
      this.isSaving = false;

      // if (e instanceof FieldErrors) {
      //   // try and link the error(s) back to individual properties in the changeset
      //   this.addFieldErrors(e);
      //   return false;
      // }

      throw e;
    }
  }

  // @action
  // addFieldErrors(errors: FieldErrors) {
  //   Object.keys(errors.map).forEach((field) => {
  //     errors.map[field].forEach((code) => {
  //       // @TODO refactor field error shape so they can be actual errors in changesets
  //       this.addGenericError(`${field}_${code}`);
  //     });
  //   });
  // }

  @action
  addGenericError(error: string) {
    this.genericErrors.push(error);
  }

  /**
   * Create a new changeset, seeded with the properties from the current model as specified by the `properties` arg
   */
  partial<T extends Pick<M, K>, K extends keyof M>(properties: K[]) {
    const model = pick<T, M>(this.change, properties);
    const validations = pick(this.validations, properties);
    return new Changeset<T>(model, validations);
  }

  /**
   * Merge a changeset containing a subset of properties into this changeset. The properties of this changeset will be set to the values
   * of the changeset being merged.
   */
  @action
  merge(changeset: Changeset<Partial<M>>) {
    Object.keys(changeset.change).forEach((k) => {
      this.change[k] = changeset.change[k];
    });
  }
}
