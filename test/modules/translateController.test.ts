'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { TranslateController } from '@/controller/TranslateController';

describe('TranslateController', () => {
  let translateController: TranslateController;

  beforeEach(() => {
    translateController = new TranslateController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(translateController).to.be.instanceOf(TranslateController);
    });
  });
});
