'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { UserController } from '@/controller/UserController';

describe('UserController', () => {
  let userController: UserController;

  beforeEach(() => {
    userController = new UserController();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(userController).to.be.instanceOf(UserController);
    });
  });
});
