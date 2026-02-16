'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { SocialAccountController } from '@/controller/socialaccount-controller';

describe('SocialAccountController', () => {
  let socialAccountController: SocialAccountController;

  beforeEach(() => {
    socialAccountController = new SocialAccountController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(socialAccountController).to.be.instanceOf(SocialAccountController);
    });
  });
});
