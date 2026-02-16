'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { EmailMarketingController } from '@/controller/emailMarketingController';

describe('EmailMarketingController', () => {
  let emailMarketingController: EmailMarketingController;

  beforeEach(() => {
    emailMarketingController = new EmailMarketingController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(emailMarketingController).to.be.instanceOf(EmailMarketingController);
    });
  });
});
