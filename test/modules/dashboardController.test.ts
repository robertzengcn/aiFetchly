'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { DashboardController } from '@/controller/DashboardController';

describe('DashboardController', () => {
  let dashboardController: DashboardController;

  beforeEach(() => {
    dashboardController = new DashboardController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(dashboardController).to.be.instanceOf(DashboardController);
    });
  });
});
