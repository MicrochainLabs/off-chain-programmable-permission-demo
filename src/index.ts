import { getAccountNonce } from 'permissionless/actions'
import { createSmartAccountClient } from 'permissionless'
import { toSafeSmartAccount } from 'permissionless/accounts'
import { erc7579Actions } from 'permissionless/actions/erc7579'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  toHex,
  Address,
  Hex,
  createPublicClient,
  http,
  toBytes,
} from 'viem'
import {
  entryPoint07Address,
  getUserOperationHash,
  createPaymasterClient,
} from 'viem/account-abstraction'
import {
  getSmartSessionsValidator,
  OWNABLE_VALIDATOR_ADDRESS,
  getSudoPolicy,
  Session,
  getAccount,
  encodeSmartSessionSignature,
  getOwnableValidatorMockSignature,
  RHINESTONE_ATTESTER_ADDRESS,
  MOCK_ATTESTER_ADDRESS,
  encodeValidatorNonce,
  getOwnableValidator,
  encodeValidationData,
  getEnableSessionDetails,
} from '@rhinestone/module-sdk'
import { polygonAmoy } from "viem/chains";
import { ContractValueWhitelistState, ContractValueWhitelistTransaction, encodeSmartSessionSignatureAndProofs, ERC7739Context, generateAndEncodeGroth16Proof, getCircuitInputs, getContractAndValueWhitelistPolicy, getContractAndValueWhitelistTrees, getContractValueWhitelistStateTree, getPermissionId, mockproof, permissionIdToConfigId } from '@rhinestone/module-sdk/module'
import path from "path";
import fs from 'fs';

async function main() {

  console.log("Off chain programmable permission demo")

  const chain = "80002";
  const apiKey = "";
  const endpointUrl = `https://api.pimlico.io/v2/${chain}/rpc?apikey=${apiKey}`

  const publicClient = createPublicClient({
    transport: http("https://rpc-amoy.polygon.technology"),
    chain: polygonAmoy,
  })
   
  const pimlicoClient = createPimlicoClient({
    transport: http(endpointUrl),
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
  })
   
  const paymasterClient = createPaymasterClient({
    transport: http(endpointUrl),
  })

  const owner = privateKeyToAccount(generatePrivateKey())

  const ownableValidator = getOwnableValidator({
    owners: [owner.address],
    threshold: 1,
  })

  const safeAccount = await toSafeSmartAccount({
    client: publicClient,
    owners: [owner],
    version: '1.4.1',
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
    safe4337ModuleAddress: '0x7579EE8307284F293B1927136486880611F20002',
    erc7579LaunchpadAddress: '0x7579011aB74c46090561ea277Ba79D510c6C00ff',
    attesters: [
      RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
      MOCK_ATTESTER_ADDRESS, // Mock Attester - do not use in production
    ],
    attestersThreshold: 1,
    validators: [
      {
        address: ownableValidator.address,
        context: ownableValidator.initData,
      },
    ],
  })

  const smartAccountClient = createSmartAccountClient({
    account: safeAccount,
    chain: polygonAmoy,
    bundlerTransport: http(endpointUrl),
    paymaster: paymasterClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast
      },
    },
  }).extend(erc7579Actions())

  const smartSessions = getSmartSessionsValidator({})
 
  const opHash = await smartAccountClient.installModule(smartSessions)
  
  const creationReceipt= await pimlicoClient.waitForUserOperationReceipt({
    hash: opHash,
  })
  console.log("Safe smart account creation")
  
  const sessionOwner = privateKeyToAccount(generatePrivateKey())
 
  const session: Session = {
    sessionValidator: OWNABLE_VALIDATOR_ADDRESS,
    sessionValidatorInitData: encodeValidationData({
      threshold: 1,
      owners: [sessionOwner.address],
    }),
    salt: toHex(toBytes('0', { size: 32 })),
    userOpPolicies: [getSudoPolicy()],
    userOpZkPolicies:[],
    erc7739Policies: {
      allowedERC7739Content: [],
      erc1271Policies: [],
    },
    actions: [
      {
        actionTarget: '0xa564cB165815937967a7d018B7F34B907B52fcFd' as Address, // an address as the target of the session execution
        actionTargetSelector: '0x00000000' as Hex, // function selector to be used in the execution, in this case no function selector is used
        actionPolicies: [getSudoPolicy()],
      },
    ],
    chainId: BigInt(polygonAmoy.id),
    permitERC4337Paymaster: true,
  }

  const permissionId = getPermissionId({
        session,
  })

  const configId = permissionIdToConfigId(permissionId, safeAccount.address);
  const contractValueWhitelistState : ContractValueWhitelistState = {
    smartAccount: safeAccount.address,
    configId: configId,
    smartContractCalls: ["0xa564cB165815937967a7d018B7F34B907B52fcFd"],
    valueTransfers: ["0xb9890DC58a1A1a9264cc0E3542093Ee0A1780822", "0xbd8faF57134f9C5584da070cC0be7CA8b5A24953", "0xa564cB165815937967a7d018B7F34B907B52fcFd"]
  }
  const contractAndValueWhitelistTrees = getContractAndValueWhitelistTrees(contractValueWhitelistState, 17)
  const stateTree = getContractValueWhitelistStateTree(contractValueWhitelistState, contractAndValueWhitelistTrees)

  session.userOpZkPolicies = [getContractAndValueWhitelistPolicy({onChainBehaviorStateTreeRoot: BigInt(stateTree.root)})]

  const txs : ContractValueWhitelistTransaction[] = [
    {
      dest: BigInt("0xa564cB165815937967a7d018B7F34B907B52fcFd"),
      value: BigInt(0),
      functionSelector: BigInt(0),
      Erc20TransferTo: BigInt(0)
    },
    {
      dest: BigInt(0),
      value: BigInt(0),
      functionSelector: BigInt(0),
      Erc20TransferTo: BigInt(0)
    }
  ]

  const account = getAccount({
    address: safeAccount.address,
    type: 'safe',
  })
   
  const sessionDetails = await getEnableSessionDetails({
    sessions: [session],
    account,
    clients: [publicClient],
  })

  
  sessionDetails.enableSessionData.enableSession.permissionEnableSig =
  await owner.signMessage({
    message: { raw: sessionDetails.permissionEnableHash },
  })

  const nonce = await getAccountNonce(publicClient, {
    address: safeAccount.address,
    entryPointAddress: entryPoint07Address,
    key: encodeValidatorNonce({
      account,
      validator: smartSessions,
    }),
  })
   
  const mockSignature = getOwnableValidatorMockSignature({
    threshold: 1,
  })
  const proofs: Hex[] = [mockproof];
  sessionDetails.signature =encodeSmartSessionSignatureAndProofs({signature:mockSignature, proofs})

  const userOperation = await smartAccountClient.prepareUserOperation({
    account: safeAccount,
    calls: [
      {
        to: session.actions[0].actionTarget, 
        value: BigInt(0),
        data: session.actions[0].actionTargetSelector,
      },
    ],
    nonce,
    signature: encodeSmartSessionSignature(sessionDetails),
    //verificationGasLimit: BigInt(1300926)
  })

  const userOpHashToSign = getUserOperationHash({
    chainId: polygonAmoy.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: '0.7',
    userOperation,
  })

  //Generate session signature
  const sessionSignature = await sessionOwner.signMessage({
    message: { raw: userOpHashToSign },
  })

  //Generate permission proof
  const witnessGenerationPath = path.join(__dirname, 'contract_value_whitelist_policy.wasm');
  const provingKeyPath = path.join(__dirname, 'contractValueWhitelistPolicy_0001.zkey');
  const inputs = getCircuitInputs(txs, userOpHashToSign, contractValueWhitelistState, contractAndValueWhitelistTrees)
  const proof = await generateAndEncodeGroth16Proof(inputs, witnessGenerationPath, provingKeyPath)
  proofs[0] = proof as Hex;
  sessionDetails.signature = encodeSmartSessionSignatureAndProofs({signature:sessionSignature, proofs})
   
  userOperation.signature = encodeSmartSessionSignature(sessionDetails)

  const userOpHash = await smartAccountClient.sendUserOperation(userOperation)
 
  const receipt = await pimlicoClient.waitForUserOperationReceipt({
    hash: userOpHash,
  })
  console.log("User Op via smart session validator")
  console.log(receipt)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });