"use strict";

class Token {
  getValue() {
    return "";
  }

  setValue() {
    return undefined;
  }

  deleteValue() {
    return undefined;
  }

  hasValue() {
    return false;
  }
}

class RefreshTokenInvalidError extends Error {
  constructor(message) {
    super(message);
    this.name = "RefreshTokenInvalidError";
  }
}

class TokenRefreshService {
  static async refreshOnce() {
    throw new Error("Token refresh is unavailable in worker processes.");
  }
}

class AIProviderResolver {}

module.exports = {
  AIProviderResolver,
  RefreshTokenInvalidError,
  Token,
  TokenRefreshService,
};
