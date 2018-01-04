import Changeset from '../src';
import { required } from 'mobx-changeset-validations';
import {observable} from 'mobx';

describe('Changeset', () => {
  it('works', () => {
    interface OnboardingData {
      username: string;
    }

    const onboardingData = observable<OnboardingData>({
      username: 'Lance'
    });

    const onboardingValidations = {
      username: required()
    };

    const cs = new Changeset<OnboardingData>(onboardingData, onboardingValidations);
    expect(cs.change.username).toEqual('Lance');
  })
})
