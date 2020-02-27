/* globals artifacts */

import BN from "bn.js";
import chai from "chai";
import bnChai from "bn-chai";
import { ethers } from "ethers";

import { giveUserCLNYTokens, giveUserCLNYTokensAndStake } from "../../helpers/test-data-generator";
import { MIN_STAKE, MINING_CYCLE_DURATION, DECAY_RATE } from "../../helpers/constants";
import { forwardTime, checkErrorRevert, getActiveRepCycle, advanceMiningCycleNoContest } from "../../helpers/test-helper";

const { expect } = chai;
chai.use(bnChai(web3.utils.BN));

const EtherRouter = artifacts.require("EtherRouter");
const IMetaColony = artifacts.require("IMetaColony");
const IColonyNetwork = artifacts.require("IColonyNetwork");
const ITokenLocking = artifacts.require("ITokenLocking");
const Token = artifacts.require("Token");
const IReputationMiningCycle = artifacts.require("IReputationMiningCycle");

contract("Reputation mining - basic functionality", accounts => {
  // Not using accounts[5] here otherwise the afterEach breaks reputation mining, which we need
  // for one of the tests.
  const MINER1 = accounts[6];
  const MINER2 = accounts[7];

  let colonyNetwork;
  let tokenLocking;
  let metaColony;
  let clnyToken;

  before(async () => {
    const etherRouter = await EtherRouter.deployed();
    colonyNetwork = await IColonyNetwork.at(etherRouter.address);
    const tokenLockingAddress = await colonyNetwork.getTokenLocking();
    tokenLocking = await ITokenLocking.at(tokenLockingAddress);
    const metaColonyAddress = await colonyNetwork.getMetaColony();
    metaColony = await IMetaColony.at(metaColonyAddress);
    const clnyAddress = await metaColony.getToken();
    clnyToken = await Token.at(clnyAddress);
  });

  afterEach(async () => {
    // Ensure consistent state of token locking and clnyToken balance for two test accounts
    const miner1Lock = await tokenLocking.getUserLock(clnyToken.address, MINER1);
    if (miner1Lock.balance > 0) {
      await tokenLocking.withdraw(clnyToken.address, miner1Lock.balance, { from: MINER1 });
    }

    const miner2Lock = await tokenLocking.getUserLock(clnyToken.address, MINER2);
    if (miner2Lock.balance > 0) {
      await tokenLocking.withdraw(clnyToken.address, miner2Lock.balance, { from: MINER2 });
    }

    const miner1Balance = await clnyToken.balanceOf(MINER1);
    await clnyToken.burn(miner1Balance, { from: MINER1 });

    const miner2Balance = await clnyToken.balanceOf(MINER2);
    await clnyToken.burn(miner2Balance, { from: MINER2 });
  });

  describe("when miners are staking CLNY", () => {
    it("should allow miners to stake CLNY", async () => {
      await giveUserCLNYTokens(colonyNetwork, MINER2, 9000);
      await clnyToken.approve(tokenLocking.address, 5000, { from: MINER2 });
      await tokenLocking.deposit(clnyToken.address, 5000, { from: MINER2 });

      const userBalance = await clnyToken.balanceOf(MINER2);
      expect(userBalance).to.eq.BN(4000);

      const info = await tokenLocking.getUserLock(clnyToken.address, MINER2);
      const stakedBalance = new BN(info.balance);
      expect(stakedBalance).to.eq.BN(5000);
    });

    it("should allow miners to withdraw staked CLNY", async () => {
      await giveUserCLNYTokensAndStake(colonyNetwork, MINER2, 5000);

      await tokenLocking.withdraw(clnyToken.address, 5000, { from: MINER2 });

      const info = await tokenLocking.getUserLock(clnyToken.address, MINER2);
      const stakedBalance = new BN(info.balance);
      expect(stakedBalance).to.be.zero;
    });

    it("should not allow miners to deposit more CLNY than they have", async () => {
      await giveUserCLNYTokens(colonyNetwork, MINER2, 9000);
      await clnyToken.approve(tokenLocking.address, 10000, { from: MINER2 });

      await checkErrorRevert(tokenLocking.deposit(clnyToken.address, 10000, { from: MINER2 }), "ds-token-insufficient-balance");

      const userBalance = await clnyToken.balanceOf(MINER2);
      expect(userBalance).to.eq.BN(9000);

      const info = await tokenLocking.getUserLock(clnyToken.address, MINER2);
      const stakedBalance = new BN(info.balance);
      expect(stakedBalance).to.be.zero;
    });

    it("should not allow miners to withdraw more CLNY than they staked, even if enough has been staked total", async () => {
      await giveUserCLNYTokensAndStake(colonyNetwork, MINER2, 9000);

      await checkErrorRevert(tokenLocking.withdraw(clnyToken.address, 10000, { from: MINER2 }), "ds-math-sub-underflow");

      const info = await tokenLocking.getUserLock(clnyToken.address, MINER2);
      const stakedBalance = new BN(info.balance);
      expect(stakedBalance).to.eq.BN(9000);

      const userBalance = await clnyToken.balanceOf(MINER2);
      expect(userBalance).to.be.zero;
    });

    it("should not allow someone to submit a new reputation hash if they are not staking", async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      await forwardTime(MINING_CYCLE_DURATION, this);

      await checkErrorRevert(repCycle.submitRootHash("0x12345678", 10, "0x00", 0), "colony-reputation-mining-zero-entry-index-passed");

      const nUniqueSubmittedHashes = await repCycle.getNUniqueSubmittedHashes();
      expect(nUniqueSubmittedHashes).to.be.zero;
    });
  });

  describe("when working with reputation functions permissions", async () => {
    it("should not allow someone who is not ColonyNetwork to appendReputationUpdateLog", async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      await checkErrorRevert(
        repCycle.appendReputationUpdateLog(MINER1, 100, 0, metaColony.address, 0, 1),
        "colony-reputation-mining-sender-not-network"
      );
    });

    it("should not allow someone who is not ColonyNetwork to reset the ReputationMiningCycle window", async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      await checkErrorRevert(repCycle.resetWindow(), "colony-reputation-mining-sender-not-network");
    });

    it('should not allow "setReputationRootHash" to be called from an account that is not a ReputationMiningCycle', async () => {
      await checkErrorRevert(
        colonyNetwork.setReputationRootHash("0x000001", 10, [accounts[0], accounts[1]], 0),
        "colony-reputation-mining-sender-not-active-reputation-cycle"
      );
    });

    it('should not allow "startNextCycle" to be called if a cycle is in progress', async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      await forwardTime(MINING_CYCLE_DURATION, this);

      expect(repCycle.address).to.not.be.zero;

      await checkErrorRevert(colonyNetwork.startNextCycle(), "colony-reputation-mining-still-active");
    });

    it('should not allow "rewardStakersWithReputation" to be called by someone not the colonyNetwork', async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);

      await checkErrorRevert(
        repCycle.rewardStakersWithReputation([MINER1], [1], ethers.constants.AddressZero, 10000, 3),
        "colony-reputation-mining-sender-not-network"
      );
    });

    it('should not allow "initialise" to be called on either the active or inactive ReputationMiningCycle', async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      await checkErrorRevert(repCycle.initialise(MINER1, MINER2), "colony-reputation-mining-cycle-already-initialised");

      const addr = await colonyNetwork.getReputationMiningCycle(false);
      const inactiveRepCycle = await IReputationMiningCycle.at(addr);

      await checkErrorRevert(inactiveRepCycle.initialise(MINER1, MINER2), "colony-reputation-mining-cycle-already-initialised");
    });
  });

  describe("when reading reputation mining constant properties", async () => {
    it("can get the minimum stake value", async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      const minStake = await repCycle.getMinStake();
      expect(minStake).to.eq.BN(MIN_STAKE);
    });

    it("can get the mining window duration", async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      const miningCycleDuration = await repCycle.getMiningWindowDuration();
      expect(miningCycleDuration).to.eq.BN(MINING_CYCLE_DURATION);
    });

    it("can get the decay constant value", async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      const decay = await repCycle.getDecayConstant();
      expect(decay.numerator).to.eq.BN(DECAY_RATE.NUMERATOR);
      expect(decay.denominator).to.eq.BN(DECAY_RATE.DENOMINATOR);
    });

    it("when there are no logs, getDisputeRewardIncrement returns 0", async () => {
      const repCycle = await getActiveRepCycle(colonyNetwork);
      const rewardIncrement = await repCycle.getDisputeRewardIncrement();
      expect(rewardIncrement.toString(), "RewardIncrement was nonzero").to.equal("0");
    });

    it("when no dispute is yet required, getDisputeRewardIncrement returns 0", async () => {
      await advanceMiningCycleNoContest({ colonyNetwork, test: this });
      await advanceMiningCycleNoContest({ colonyNetwork, test: this });
      const repCycle = await getActiveRepCycle(colonyNetwork);
      const rewardIncrement = await repCycle.getDisputeRewardIncrement();
      expect(rewardIncrement.toString(), "RewardIncrement was nonzero").to.equal("0");
    });
  });
});
