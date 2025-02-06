import mongoose from "mongoose";

const PoolSchema = new mongoose.Schema({
  // Core Pool Information
  tokenAddress: { type: String, required: true, index: true },
  tokenSymbol: { type: String, required: true },
  poolAddress: { type: String, required: true },
  positionPubKey: { type: String, required: true },

  // Position Configuration
  binRange: {
    minBinId: { type: Number, required: true },
    maxBinId: { type: Number, required: true },
  },
  initialTokenXAmount: { type: String, required: true }, // BN amounts stored as strings
  initialTokenYAmount: { type: String, required: true },

  // Market Metrics
  volumeToMarketcapAtEntry: { type: Number, required: true },
  currentVolumeToMarketcap: { type: Number },
  volumeRatio: { type: Number },
  volumeHistory: [
    {
      timestamp: { type: Date, required: true },
      volumeToMarketcap: { type: Number, required: true },
      ratio: { type: Number, required: true },
    },
  ],

  // Price Tracking
  entryPrice: { type: Number, required: true },
  currentPrice: { type: Number },
  exitPrice: { type: Number },

  // Fee Tracking
  claimedFees: {
    tokenX: { type: String, default: "0" }, // BN amount stored as string
    tokenY: { type: String, default: "0" }, // BN amount stored as string
  },

  // Status and Timestamps
  status: {
    type: String,
    enum: ["active", "closed"],
    default: "active",
    required: true,
  },
  createdAt: { type: Date, required: true, default: Date.now },
  closedAt: { type: Date },
  lastUpdated: { type: Date },

  // Performance
  profitLoss: { type: Number },
  transactionHashes: [String],
});

export const Pool = mongoose.model("Pool", PoolSchema);
