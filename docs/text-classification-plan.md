# Implementation Plan: NLP vs. Command Classifier

This document outlines the strategy for integrating a lightweight classification system into a Node.js environment to distinguish between **Terminal Commands** and **Natural Language**.

---

## 1. Project Goals
* **Low Latency:** Classification must happen in < 50ms.
* **Local Execution:** No external API calls; entirely embedded.
* **Minimal Footprint:** Use lightweight libraries to keep the bundle small.

---

## 2. Technical Stack
| Component | Library | Purpose |
| :--- | :--- | :--- |
| **NLP Engine** | `natural` | Core Bayes classification logic. |
| **Parsing** | `compromise` | (Optional) For high-speed structural analysis. |
| **Storage** | Native JSON | To store the trained model state. |

---

## 3. Architecture Logic
We use a **Two-Tier Filter** to ensure speed:

1. **Tier 1: Heuristic Filter (Regex)**
   Immediately flags strings starting with system-specific characters or common CLI prefixes (e.g., `./`, `sudo`, `npm`).
2. **Tier 2: Statistical Filter (Bayes)**
   The `natural` library calculates the probability of the input being "Speech" vs "Terminal" based on a pre-trained local model.

---

## 4. Step-by-Step Implementation

### Step 1: Install Dependencies
```bash
npm install natural
```

### Step 2: Create the Trainer (`trainer.js`)
Run this once to generate your model.
```javascript
const natural = require('natural');
const classifier = new natural.BayesClassifier();

// Command Training Data
classifier.addDocument('git commit -m "update"', 'terminal');
classifier.addDocument('npm install lodash', 'terminal');
classifier.addDocument('ls -la /var/www', 'terminal');
classifier.addDocument('cd ..', 'terminal');
classifier.addDocument('docker-compose up -d', 'terminal');

// Natural Language Training Data
classifier.addDocument('How do I install this?', 'speech');
classifier.addDocument('can you help me with a bug', 'speech');
classifier.addDocument('what is the weather today', 'speech');
classifier.addDocument('I am trying to run the app', 'speech');

classifier.train();
classifier.save('classifier.json', (err) => {
    if (err) console.error(err);
    else console.log('Model saved to classifier.json');
});
```

### Step 3: Deployment Logic (`index.js`)
```javascript
const natural = require('natural');

let classifier;
// Load the pre-trained model
natural.BayesClassifier.load('classifier.json', null, (err, loaded) => {
    if (err) return console.error("Model not found. Run trainer.js first.");
    classifier = loaded;
});

function processInput(input) {
    if (!classifier) return 'loading';

    // 1. Heuristic Check (Fastest)
    if (/^(\.\/|sudo\s|npm\s|git\s|cd\s)/.test(input) || input.includes('--')) {
        return 'terminal';
    }
    
    // 2. Statistical NLP Check
    return classifier.classify(input);
}
```

---

## 5. Success Metrics & Maintenance
* **Performance:** Ensure classification speed remains under 20ms in production.
* **Accuracy:** Aim for > 90% on common developer inputs.
* **Refinement:** If the classifier misses a command, add that specific string to `trainer.js` and re-run to improve the model.