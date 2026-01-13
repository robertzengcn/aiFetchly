'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { EmailextractionController } from '../../src/controller/emailextractionController';

describe('EmailextractionController', () => {
  let emailExtractionController: EmailextractionController;

  beforeEach(() => {
    emailExtractionController = new EmailextractionController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(emailExtractionController).to.be.instanceOf(EmailextractionController);
    });
  });
});
