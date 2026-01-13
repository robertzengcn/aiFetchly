'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { BuckemailController } from '../../src/controller/buckemailController';

describe('BuckemailController', () => {
  let buckEmailController: BuckemailController;

  beforeEach(() => {
    buckEmailController = new BuckemailController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(buckEmailController).to.be.instanceOf(BuckemailController);
    });
  });
});
