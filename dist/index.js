import { createHash } from 'crypto';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { v4 as uuid4 } from 'uuid';
function calculateSHA256Hash(data) {
    const hash = createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
}
class BlockChain {
    chain = [];
    currentTransactions = [];
    nodes = new Set();
    constructor() {
        this.newBlock(100, '1');
    }
    static validProof(lastProof, proof) {
        const guess = `${lastProof}${proof}`;
        const guessHash = calculateSHA256Hash(guess);
        return guessHash.slice(0, 4) === '0000';
    }
    static hash(block) {
        const blockString = JSON.stringify(block);
        return calculateSHA256Hash(blockString);
    }
    get lastBlock() {
        return this.chain[this.chain.length - 1];
    }
    newBlock(proof, previousHash) {
        const block = {
            index: this.chain.length + 1,
            timestamp: Date.now(),
            transactions: this.currentTransactions,
            proof,
            previousHash: previousHash || BlockChain.hash(this.chain[this.chain.length - 1]),
        };
        this.currentTransactions = [];
        this.chain.push(block);
        return block;
    }
    newTransaction(sender, recipient, amount) {
        this.currentTransactions.push({
            sender,
            recipient,
            amount,
        });
        return this.lastBlock.index + 1;
    }
    proofOfWork(lastProof) {
        let proof = 0;
        while (!BlockChain.validProof(lastProof, proof)) {
            proof += 1;
        }
        return proof;
    }
    registerNode(address) {
        const parsedUrl = new URL(address);
        this.nodes.add(parsedUrl.hostname + ':' + parsedUrl.port);
    }
    validChain(chain) {
        let lastBlock = chain[0];
        let currentIndex = 1;
        // 对链上的每一个节点进行校验
        while (currentIndex < chain.length) {
            const block = chain[currentIndex];
            // 如果当前节点的previousHash不等于上一个节点的hash，则说明链不合法
            if (block.previousHash !== BlockChain.hash(lastBlock)) {
                return false;
            }
            // 如果当前节点的proof不合法，则说明链不合法
            if (!BlockChain.validProof(lastBlock.proof, block.proof)) {
                return false;
            }
            lastBlock = block;
            currentIndex += 1;
        }
        return true;
    }
    async resolveConflicts() {
        const neighbours = this.nodes;
        let newChain = null;
        let maxLength = this.chain.length;
        for (const node of neighbours) {
            // 访问其他节点的chain接口
            const response = await fetch(`http://${node}/chain`);
            if (response.ok) {
                const { length, chain } = await response.json();
                // 如果存在其他节点的链比自己长，且合法，则替换自己的链
                if (length > maxLength && this.validChain(chain)) {
                    maxLength = length;
                    newChain = chain;
                }
            }
        }
        if (newChain) {
            this.chain = newChain;
            return true;
        }
        return false;
    }
}
const blockChain = new BlockChain();
const app = new Koa();
const router = new Router();
const nodeIdentifier = uuid4().replace('-', '');
app.use(bodyParser());
app.use(router.routes())
    .use(router.allowedMethods());
router.get('/mine', (ctx) => {
    const lastBlock = blockChain.lastBlock;
    const lastProof = lastBlock.proof;
    const proof = blockChain.proofOfWork(lastProof);
    blockChain.newTransaction('0', nodeIdentifier, 1);
    const previousHash = BlockChain.hash(lastBlock);
    const block = blockChain.newBlock(proof, previousHash);
    ctx.body = {
        message: 'New Block Forged',
        index: block.index,
        transactions: block.transactions,
        proof: block.proof,
        previousHash: block.previousHash,
    };
})
    .get('/chain', (ctx) => {
    // 返回整个区块链以及其长度
    ctx.body = {
        chain: blockChain.chain,
        length: blockChain.chain.length,
    };
})
    .post('/transactions/new', (ctx) => {
    const { sender, recipient, amount } = ctx.request.body;
    const index = blockChain.newTransaction(sender, recipient, amount);
    ctx.body = `Transaction will be added to Block ${index}`;
})
    .post('/nodes/register', (ctx) => {
    const { nodes } = ctx.request.body;
    if (!nodes) {
        ctx.throw(400, 'Error: Please supply a valid list of nodes');
    }
    nodes.forEach((node) => {
        blockChain.registerNode(node);
    });
    ctx.body = {
        message: 'New nodes have been added',
        totalNodes: Array.from(blockChain.nodes),
    };
})
    .get('/nodes/resolve', async (ctx) => {
    const replaced = await blockChain.resolveConflicts();
    ctx.body = {
        message: replaced ? 'Our chain was replaced' : 'Our chain is authoritative',
        newChain: blockChain.chain,
    };
});
// 根据启动的 参数确定端口号，默认3000
app.listen(Number(process.argv[2] || 3000), () => {
    console.log(`Server running on port ${Number(process.argv[2] || 3000)}`);
});
