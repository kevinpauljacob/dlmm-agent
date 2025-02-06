import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export interface BinRange {
  minBinId: number;
  maxBinId: number;
}

export interface LiquidityPosition {
  tokenX: string;
  tokenY: string;
  positionPubKey: PublicKey;
  binRange: BinRange;
  liquidity: {
    tokenXAmount: BN;
    tokenYAmount: BN;
  };
}

export interface PoolConfig {
  address: PublicKey;
  binStep: number;
  totalRangeInterval: number;
  rebalanceThreshold: number; // Percentage change that triggers rebalance
}
