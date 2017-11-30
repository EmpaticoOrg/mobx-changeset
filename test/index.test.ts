import {expect} from 'chai';
import hello from '../src';

describe('Hello World', () => {
  it('works', () => {
    expect(hello()).to.equal('Hello World')
  })
})
