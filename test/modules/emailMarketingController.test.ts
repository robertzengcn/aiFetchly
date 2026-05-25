'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { EmailMarketingController } from '@/controller/emailMarketingController';
import { EmailServiceEntity } from '@/entity/EmailService.entity';
import { EmailServiceModuleInterface } from '@/modules/interface/EmailServiceModuleInterface';

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

  describe('createEmailService', () => {
    it('updates an existing service with the same name instead of creating a duplicate', async () => {
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = 'Primary SMTP';
      existing.from = 'sender@example.com';
      existing.host = 'smtp.example.com';
      existing.port = '465';
      existing.password = 'old-password';
      existing.ssl = 1;

      const updateEmailService = sinon.stub().resolves();
      const createEmailService = sinon.stub().resolves(8);
      emailMarketingController.emailServiceModule = {
        findEmailServiceByName: sinon.stub().resolves(existing),
        findEmailServicesByHost: sinon.stub().resolves([]),
        updateEmailService,
        createEmailService,
      } as unknown as EmailServiceModuleInterface;

      const result = await emailMarketingController.createEmailService({
        name: 'Primary SMTP',
        from: 'sender@example.com',
        host: 'smtp.example.com',
        port: '465',
        password: 'new-password',
        ssl: 1,
      });

      expect(result).to.equal(7);
      expect(updateEmailService.calledOnce).to.equal(true);
      expect(updateEmailService.firstCall.args[0]).to.equal(7);
      expect(updateEmailService.firstCall.args[1].password).to.equal('new-password');
      expect(createEmailService.called).to.equal(false);
    });
  });
});
