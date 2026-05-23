'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { RagSearchController } from '@/controller/RagSearchController';

describe('RagSearchController', () => {
  let ragSearchController: RagSearchController;

  beforeEach(() => {
    ragSearchController = new RagSearchController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(ragSearchController).to.be.instanceOf(RagSearchController);
    });
  });
});
