'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { SearchController } from '../../src/controller/SearchController';

describe('SearchController', () => {
  let searchController: SearchController;

  beforeEach(() => {
    searchController = SearchController.getInstance();
  });

  describe('basic functionality', () => {
    it('should be instantiated', () => {
      expect(searchController).to.be.instanceOf(SearchController);
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = SearchController.getInstance();
      const instance2 = SearchController.getInstance();
      expect(instance1).to.equal(instance2);
    });
  });
});
