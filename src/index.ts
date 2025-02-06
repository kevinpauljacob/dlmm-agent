import axios from "axios";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { config } from "dotenv";
import DLMM from "@meteora-ag/dlmm";
import {
  getTokenTradeData,
  getTokenMarketData,
  getBestTradingOpportunity,
} from "./services/marketData";
import {
  getActiveBin,
  initializeDLMMPool,
  createPosition,
  removeLiquidity,
} from "./services/managePool";
import connectToDatabase from "./utils/database";
import { Pool } from "./models/pool";
import { type TokenAnalysis, type SelectedToken } from "./types/market";
import { type PoolConfig, type LiquidityPosition } from "./types/pool";

config();

// Configuration Constants
const VOLUME_THRESHOLD = 0.15; // 15% of entry volume
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const REBALANCE_INTERVAL = 15 * 60 * 1000; // 15 minutes
// const MAX_POOL_LIFESPAN = 3 * 24 * 60 * 60 * 1000; // 3 days
const MAX_POOL_LIFESPAN = 20 * 60 * 1000;
const CAPITAL_ALLOCATION = new BN("10000000"); // 0.01 SOL in lamports

interface DLMMPoolInfo {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  base_fee_percentage: string;
}

async function findSuitablePools(
  tokenAddress: string
): Promise<DLMMPoolInfo[]> {
  try {
    const response = await axios.get("https://dlmm-api.meteora.ag/pair/all");
    const pools = response.data
      .filter(
        (pool: DLMMPoolInfo) =>
          pool.mint_x === tokenAddress || pool.mint_y === tokenAddress
      )
      .sort(
        (a: DLMMPoolInfo, b: DLMMPoolInfo) =>
          parseFloat(a.base_fee_percentage) - parseFloat(b.base_fee_percentage)
      );
    console.log("Available Pools", pools);
    return pools;
  } catch (error) {
    console.error("Error finding suitable pools:", error);
    return [];
  }
}

async function monitorPosition(
  connection: Connection,
  dlmmPool: DLMM,
  user: Keypair,
  position: LiquidityPosition,
  poolTracker: any,
  initialVolumeToMarketcap: number
) {
  const startTime = Date.now();

  while (true) {
    try {
      // Check pool lifespan
      if (Date.now() - startTime >= MAX_POOL_LIFESPAN) {
        console.log(`Max lifespan reached for pool ${poolTracker.poolAddress}`);
        break;
      }

      // Fetch latest token data from Birdeye
      const [marketData, tradeData] = await Promise.all([
        getTokenMarketData(poolTracker.tokenAddress),
        getTokenTradeData(poolTracker.tokenAddress),
      ]);

      // Calculate current volume to marketcap ratio
      const currentVolumeToMarketcap =
        tradeData.volume_1h_usd / marketData.marketcap;
      const volumeRatio = currentVolumeToMarketcap / initialVolumeToMarketcap;
      console.log(
        `Initial volume to marketcap ratio: ${initialVolumeToMarketcap}`
      );
      console.log(
        `Current volume to marketcap ratio: ${currentVolumeToMarketcap}`
      );
      console.log(
        `Volume ratio: ${volumeRatio} (Threshold: ${VOLUME_THRESHOLD})`
      );
      // Update pool tracker with latest stats
      await Pool.findOneAndUpdate(
        { _id: poolTracker._id },
        {
          $set: {
            currentPrice: marketData.price,
            lastUpdated: new Date(),
            currentVolumeToMarketcap,
            volumeRatio,
          },
          $push: {
            volumeHistory: {
              timestamp: new Date(),
              volumeToMarketcap: currentVolumeToMarketcap,
              ratio: volumeRatio,
            },
          },
        }
      );

      // Check volume threshold
      if (volumeRatio < VOLUME_THRESHOLD) {
        console.log(
          `Volume ratio (${volumeRatio}) dropped below threshold (${VOLUME_THRESHOLD})`
        );
        break;
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL));
    } catch (error) {
      console.error("Error monitoring position:", error);
      await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL));
    }
  }

  // Close position and update stats
  await closePools(connection, dlmmPool, user, position, poolTracker);
}

async function closePools(
  connection: Connection,
  dlmmPool: DLMM,
  user: Keypair,
  position: LiquidityPosition,
  poolTracker: any
) {
  try {
    // Get position data before removal to check fees
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
      user.publicKey
    );
    const userPosition = userPositions.find(({ publicKey }) =>
      publicKey.equals(position.positionPubKey)
    );

    const feesAndPosition = {
      fees: {
        tokenX: userPosition?.positionData.feeX.toString(),
        tokenY: userPosition?.positionData.feeY.toString(),
        lastUpdated: new Date(),
      },
      finalPosition: {
        tokenX: userPosition?.positionData.totalXAmount.toString(),
        tokenY: userPosition?.positionData.totalYAmount.toString(),
      },
    };

    // Remove all liquidity and claim fees
    const txHashes = await removeLiquidity(
      connection,
      dlmmPool,
      user,
      position.positionPubKey
    );

    // Update pool tracker with closing details and claimed fees
    await Pool.findOneAndUpdate(
      { _id: poolTracker._id },
      {
        status: "closed",
        closedAt: new Date(),
        ...feesAndPosition,
        transactionHashes: txHashes,
      }
    );

    console.log(`Closed position for ${poolTracker.tokenSymbol}`);
    console.log("Final fees collected:", feesAndPosition.fees);
    console.log("Final position amounts:", feesAndPosition.finalPosition);
  } catch (error) {
    console.error("Error closing pool:", error);
  }
}

async function resumeExistingPool(
  connection: Connection,
  user: Keypair,
  poolData: any
): Promise<void> {
  console.log(`Resuming monitoring for pool: ${poolData.poolAddress}`);

  // Initialize DLMM pool
  const dlmmPool = await initializeDLMMPool(connection, poolData.poolAddress);

  // Reconstruct position object
  const position = {
    tokenX: dlmmPool.tokenX.publicKey.toString(),
    tokenY: dlmmPool.tokenY.publicKey.toString(),
    positionPubKey: new PublicKey(poolData.positionPubKey),
    binRange: poolData.binRange,
    liquidity: {
      tokenXAmount: new BN(poolData.initialTokenXAmount),
      tokenYAmount: new BN(poolData.initialTokenYAmount),
    },
  };

  // Calculate time elapsed since pool creation
  const timeElapsed = Date.now() - poolData.createdAt.getTime();
  const remainingLifespan = MAX_POOL_LIFESPAN - timeElapsed;

  if (remainingLifespan <= 0) {
    console.log(`Pool ${poolData.poolAddress} has exceeded maximum lifespan`);
    await closePools(connection, dlmmPool, user, position, poolData);
    return;
  }

  // Get initial volume to marketcap ratio from pool data
  const [marketData, tradeData] = await Promise.all([
    getTokenMarketData(poolData.tokenAddress),
    getTokenTradeData(poolData.tokenAddress),
  ]);

  const initialVolumeToMarketcap =
    poolData.volumeToMarketcapAtEntry ||
    tradeData.volume_1h_usd / marketData.marketcap;

  // Resume monitoring
  await monitorPosition(
    connection,
    dlmmPool,
    user,
    position,
    poolData,
    initialVolumeToMarketcap
  );
}

async function main() {
  try {
    // Initialize connection and user
    const connection = new Connection(
      process.env.RPC_ENDPOINT! ||
        "https://mainnet.helius-rpc.com/?api-key=4de31cf1-5362-4ef6-96cc-7abf1cf18544"
    );
    const user = Keypair.fromSecretKey(
      bs58.decode(
        process.env.WALLET_PRIVATE_KEY! ||
          "qZ1qESPqdT8unwUAsdDHwCp8mZadc2C1vF31rCUm9Fym2bVvtrBmidKaUxujZz44dtmYDjFNZpW6MZB1i4yT4Hz"
      )
    );

    // Check for active pools in database
    const activePools = await Pool.find({ status: "active" });

    if (activePools.length > 0) {
      console.log(
        `Found ${activePools.length} active pools. Resuming monitoring...`
      );
      for (const poolData of activePools) {
        await resumeExistingPool(connection, user, poolData);
      }
    }

    while (true) {
      // Find best trading opportunity
      console.log("Finding best trading opportunity...");
      const opportunity = await getBestTradingOpportunity();
      if (!opportunity) {
        console.log("No suitable trading opportunities found");
        continue;
      }

      const { analysis, selectedToken } = opportunity;
      console.log(`Selected token: ${selectedToken.symbol}`);

      // Find suitable pools for the token
      const pools = await findSuitablePools(selectedToken.address);
      if (pools.length === 0) {
        console.log(`No pools found for ${analysis.symbol}`);
        continue;
      }

      // Select the pool with lowest fees
      const selectedPool = pools[0];

      // Initialize DLMM pool
      const dlmmPool = await initializeDLMMPool(
        connection,
        selectedPool.address
      );
      await getActiveBin(dlmmPool);
      console.log(`Initialized DLMM pool for ${selectedPool.address}`);

      // Create position
      const position = await createPosition(
        connection,
        dlmmPool,
        user,
        CAPITAL_ALLOCATION,
        {
          address: new PublicKey(selectedPool.address),
          binStep: 10,
          totalRangeInterval: 10,
          rebalanceThreshold: 20,
        }
      );
      console.log(`Created position for ${selectedToken.symbol}`);

      // Create pool tracker entry
      const poolTracker = new Pool({
        tokenAddress: selectedToken.address,
        tokenSymbol: selectedToken.symbol,
        poolAddress: selectedPool.address,
        positionPubKey: position.positionPubKey.toString(),
        binRange: position.binRange,
        initialTokenXAmount: position.liquidity.tokenXAmount.toString(),
        initialTokenYAmount: position.liquidity.tokenYAmount.toString(),
        createdAt: new Date(),
        status: "active",
        entryPrice: analysis.price,
        volumeToMarketcapAtEntry: selectedToken.volumeToMarketcapAtEntry,
        currentVolumeToMarketcap: selectedToken.volumeToMarketcapAtEntry,
        lastUpdated: new Date(),
      });
      await poolTracker.save();

      // Monitor position
      await monitorPosition(
        connection,
        dlmmPool,
        user,
        position,
        poolTracker,
        selectedToken.volumeToMarketcapAtEntry
      );
      console.log(`Monitoring position for ${selectedToken.symbol}`);
    }
  } catch (error) {
    console.error("Main script error:", error);
    process.exit(1);
  }
}

// Connect to database and start the script
connectToDatabase()
  .then(() => {
    console.log("Connected to database");
    main().catch(console.error);
  })
  .catch((error) => {
    console.error("Failed to connect to database:", error);
    process.exit(1);
  });
