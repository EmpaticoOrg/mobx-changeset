import hello from '../src';

describe('Hello World', () => {
  it('works', () => {
    expect(hello()).toEqual('Hello World')
  })
})
