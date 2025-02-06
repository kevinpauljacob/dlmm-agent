import {
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  Keypair,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import DLMM from "@meteora-ag/dlmm";
import { StrategyType, BinLiquidity } from "@meteora-ag/dlmm";
import {
  type BinRange,
  type LiquidityPosition,
  type PoolConfig,
} from "../types/pool";

let activeBin: BinLiquidity;

export async function getActiveBin(dlmmPool: DLMM) {
  activeBin = await dlmmPool.getActiveBin();
  console.log("Active bin:", activeBin);
}

export async function initializeDLMMPool(
  connection: Connection,
  poolAddress: string
): Promise<DLMM> {
  try {
    const poolPubKey = new PublicKey(poolAddress);
    const dlmmPool = await DLMM.create(connection, poolPubKey, {
      cluster: "devnet",
    });
    await dlmmPool.refetchStates(); // Ensure we have latest state
    return dlmmPool;
  } catch (error) {
    console.error("Error initializing DLMM pool:", error);
    throw error;
  }
}

export async function calculateBinRange(
  dlmmPool: DLMM,
  config: PoolConfig
): Promise<BinRange> {
  try {
    const { binId: activeBinId } = await dlmmPool.getActiveBin();
    return {
      minBinId: activeBinId - config.totalRangeInterval,
      maxBinId: activeBinId + config.totalRangeInterval,
    };
  } catch (error) {
    console.error("Error calculating bin range:", error);
    throw error;
  }
}

export async function createPosition(
  connection: Connection,
  dlmmPool: DLMM,
  user: Keypair,
  amount: BN,
  config: PoolConfig
): Promise<LiquidityPosition> {
  try {
    await dlmmPool.refetchStates();
    console.log("here 1");
    const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
      Number(activeBin.price)
    );
    // Convert decimal price to integer with proper scaling
    const priceScaleFactor = 1e9; // Adjust scale factor based on token decimals
    const scaledPrice = Math.floor(
      Number(activeBinPricePerToken) * priceScaleFactor
    );

    // Calculate amounts based on current price
    const totalYAmount = amount
      .mul(new BN(scaledPrice))
      .div(new BN(priceScaleFactor));

    // Calculate bin range around active bin
    const binRange = await calculateBinRange(dlmmPool, config);
    // Create new position keypair
    const newBalancePosition = Keypair.generate();

    console.log("here 2");
    // Create position transaction
    const createPositionTx =
      await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newBalancePosition.publicKey,
        user: user.publicKey,
        totalXAmount: amount,
        totalYAmount,
        strategy: {
          maxBinId: binRange.maxBinId,
          minBinId: binRange.minBinId,
          strategyType: StrategyType.SpotBalanced,
        },
      });
    console.log("here 3", createPositionTx);
    // Send transaction
    const txHash = await sendAndConfirmTransaction(
      connection,
      createPositionTx,
      [user, newBalancePosition]
      // { skipPreflight: false, preflightCommitment: "confirmed" }
    );

    console.log("Position created, transaction:", txHash);

    return {
      tokenX: dlmmPool.tokenX.publicKey.toString(),
      tokenY: dlmmPool.tokenY.publicKey.toString(),
      positionPubKey: newBalancePosition.publicKey,
      binRange,
      liquidity: {
        tokenXAmount: amount,
        tokenYAmount: totalYAmount,
      },
    };
  } catch (error) {
    console.error("Error creating position:", error);
    throw error;
  }
}

export async function addLiquidity(
  connection: Connection,
  dlmmPool: DLMM,
  user: Keypair,
  position: LiquidityPosition,
  amount: BN
): Promise<string> {
  try {
    await dlmmPool.refetchStates();

    // Calculate current price and Y amount
    const { price } = await dlmmPool.getActiveBin();
    const priceNum = Number(dlmmPool.fromPricePerLamport(Number(price)));
    const totalYAmount = amount.mul(new BN(priceNum));

    // Create add liquidity transaction
    const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
      positionPubKey: position.positionPubKey,
      user: user.publicKey,
      totalXAmount: amount,
      totalYAmount,
      strategy: {
        maxBinId: position.binRange.maxBinId,
        minBinId: position.binRange.minBinId,
        strategyType: StrategyType.SpotBalanced,
      },
    });

    // Send transaction
    const txHash = await sendAndConfirmTransaction(
      connection,
      addLiquidityTx,
      [user],
      { skipPreflight: false, preflightCommitment: "confirmed" }
    );

    return txHash;
  } catch (error) {
    console.error("Error adding liquidity:", error);
    throw error;
  }
}

export async function removeLiquidity(
  connection: Connection,
  dlmmPool: DLMM,
  user: Keypair,
  position: PublicKey,
  percentage: number = 100 // Default to removing all liquidity
): Promise<string[]> {
  try {
    await dlmmPool.refetchStates();

    // Get position data
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
      user.publicKey
    );
    const userPosition = userPositions.find(({ publicKey }) =>
      publicKey.equals(position)
    );

    if (!userPosition) {
      throw new Error("Position not found");
    }

    // Get bin IDs to remove liquidity from
    const binIdsToRemove = userPosition.positionData.positionBinData.map(
      (bin) => bin.binId
    );

    // Create remove liquidity transaction
    const removeLiquidityTx = await dlmmPool.removeLiquidity({
      position,
      user: user.publicKey,
      binIds: binIdsToRemove,
      bps: new Array(binIdsToRemove.length).fill(new BN(percentage * 100)),
      shouldClaimAndClose: percentage === 100, // Close position if removing all liquidity
    });

    // Send transaction(s)
    const txHashes: string[] = [];
    for (let tx of Array.isArray(removeLiquidityTx)
      ? removeLiquidityTx
      : [removeLiquidityTx]) {
      const txHash = await sendAndConfirmTransaction(connection, tx, [user], {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      txHashes.push(txHash);
    }

    return txHashes;
  } catch (error) {
    console.error("Error removing liquidity:", error);
    throw error;
  }
}

export async function checkAndRebalance(
  connection: Connection,
  dlmmPool: DLMM,
  user: Keypair,
  position: LiquidityPosition,
  config: PoolConfig
): Promise<boolean> {
  try {
    await dlmmPool.refetchStates();

    // Get current active bin
    const { binId: currentActiveBin } = await dlmmPool.getActiveBin();

    // Calculate distance from position's center
    const positionCenter = Math.floor(
      (position.binRange.maxBinId + position.binRange.minBinId) / 2
    );
    const binDistance = Math.abs(currentActiveBin - positionCenter);

    // Check if rebalancing is needed
    const totalRange = position.binRange.maxBinId - position.binRange.minBinId;
    const distancePercentage = (binDistance / totalRange) * 100;

    if (distancePercentage > config.rebalanceThreshold) {
      // Remove current liquidity
      await removeLiquidity(
        connection,
        dlmmPool,
        user,
        position.positionPubKey
      );

      // Calculate new bin range
      const newBinRange = await calculateBinRange(dlmmPool, config);

      // Add liquidity with new range
      await addLiquidity(
        connection,
        dlmmPool,
        user,
        { ...position, binRange: newBinRange },
        position.liquidity.tokenXAmount
      );

      return true;
    }

    return false;
  } catch (error) {
    console.error("Error in rebalance check:", error);
    throw error;
  }
}
