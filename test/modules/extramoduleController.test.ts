'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ExtraModuleController } from '../../src/controller/extramoduleController';

describe('ExtraModuleController', () => {
  let extramoduleController: ExtraModuleController;

  beforeEach(() => {
    extramoduleController = new ExtraModuleController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(extramoduleController).to.be.instanceOf(ExtraModuleController);
    });
  });
});
