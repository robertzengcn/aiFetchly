'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CampaignController } from '@/controller/campaignController';

describe('CampaignController', () => {
  let campaignController: CampaignController;

  beforeEach(() => {
    campaignController = new CampaignController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(campaignController).to.be.instanceOf(CampaignController);
    });
  });
});
