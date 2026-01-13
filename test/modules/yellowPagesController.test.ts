'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { YellowPagesController } from '../../src/controller/YellowPagesController';

describe('YellowPagesController', () => {
  let yellowPagesController: YellowPagesController;

  beforeEach(() => {
    yellowPagesController = YellowPagesController.getInstance();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(yellowPagesController).to.be.instanceOf(YellowPagesController);
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = YellowPagesController.getInstance();
      const instance2 = YellowPagesController.getInstance();
      expect(instance1).to.equal(instance2);
    });
  });
});
