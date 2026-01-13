'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ScheduleController } from '@/controller/ScheduleController';

describe('ScheduleController', () => {
  let scheduleController: ScheduleController;

  beforeEach(() => {
    scheduleController = new ScheduleController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(scheduleController).to.be.instanceOf(ScheduleController);
    });
  });
});
