'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ProxyController } from '@/controller/proxy-controller';

describe('ProxyController', () => {
  let proxyController: ProxyController;

  beforeEach(() => {
    proxyController = new ProxyController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(proxyController).to.be.instanceOf(ProxyController);
    });
  });
});
