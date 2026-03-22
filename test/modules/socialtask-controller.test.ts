'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { SocialTaskController } from '@/controller/socialtask-controller';

describe('SocialTaskController', () => {
  let socialTaskController: SocialTaskController;

  beforeEach(() => {
    socialTaskController = new SocialTaskController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(socialTaskController).to.be.instanceOf(SocialTaskController);
    });
  });
});
