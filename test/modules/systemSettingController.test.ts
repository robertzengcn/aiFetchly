'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { SystemSettingController } from '@/controller/SystemSettingController';

describe('SystemSettingController', () => {
  let systemSettingController: SystemSettingController;

  beforeEach(() => {
    systemSettingController = new SystemSettingController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(systemSettingController).to.be.instanceOf(SystemSettingController);
    });
  });
});
