# Your steps for the Arc Microgrants entry (about 20 minutes in total)

Remitsheet is built, tested and live at https://aratass.github.io/remitsheet/ (code: https://github.com/aratass/remitsheet). The program only accepts projects that are live on Arc mainnet, so the last steps need your wallet and your DoraHacks account. Everything below is in the order to do it. Steps marked **[done]** or **[agents]** need nothing from you.

Deadline: submit on DoraHacks by **14 Oct 2026, 12:00 UTC** (the form closes 15 Oct 03:59 UTC).

Never share your wallet's secret recovery phrase with anyone, including us.

---

## Part 1: wallet and USDC (about 10 minutes)

### 1. Browser wallet (5 min, skip if you already have Rabby or MetaMask)
1. In Chrome, open https://rabby.io and click the Chrome download button. It opens the Chrome Web Store; click **Add to Chrome**.
2. Rabby opens a tab: choose **Create new address**, set a password, and write the 12 recovery words on paper. Keep the paper safe and offline.
3. Click the Rabby icon in the toolbar, then click your address at the top to copy it. This is your **main address**; you use it for gas, for the test payment and for the grant payout. You need no other addresses.

### 2. Send a little USDC from Kraken to your wallet on Arc (3 min plus waiting)
1. Kraken → **Transfer** (or **Withdraw**) → choose **USDC**.
2. Network: choose **Arc**. Kraken supports USDC on Arc since 16 Sep 2026: https://blog.kraken.com/product/new-features/usdc-on-arc-deposits-and-withdrawals-now-available
3. **Add address**: paste your **main address** and name it "Rabby Arc". Kraken may email you a confirmation link for a new address; click it.
4. Amount: **5 USDC**. Kraken shows its minimum and fee for Arc on this form. If the minimum is higher than 5, withdraw the minimum.
   - We could not read Kraken's Arc fee table from here.
   - What you will actually spend on Arc is under 0.05 USDC: about 0.01 USDC to deploy the contract and fractions of a cent in network fees. The 0.01 USDC test payment goes to your own address, so you keep it.
   - The rest stays in your wallet.
5. Confirm with your 2FA. It usually arrives within minutes. You can check by opening https://explorer.arc.io/address/YOUR_MAIN_ADDRESS (replace the end with your address).

### 3. Repository and website **[done]**
The repository https://github.com/aratass/remitsheet is public and the website https://aratass.github.io/remitsheet/ is live (done 12 Oct). When the USDC has arrived, write "sent" in the chat.

---

## Part 2: deploy and test payment (about 6 minutes)

### 4. Deploy the contract on Arc mainnet (3 min, costs about 0.01 USDC)
1. Open https://aratass.github.io/remitsheet/#/deploy
2. Click **Connect wallet** → **Rabby** → choose your **main address**.
3. If Rabby asks to add or switch to the **Arc** network (chain ID 5042), approve it.
4. The page should say **Not deployed yet** and show the network fee. Click **Deploy on Arc mainnet** and confirm in Rabby.
   - The contract address is fixed in advance: `0x015153204C9A1cBAefB959782490db74cD1a7DF5`.
   - The contract has no owner, so deploying it gives nobody control over anyone's money.
5. Wait for **Remitsheet is live on Arc mainnet**. Click **Deployment transaction** and copy that page's address (URL).

### 5. Make one real payment to yourself, so there is a mainnet receipt (3 min, the 0.01 USDC comes back to you)
1. Click **Pay** at the top.
2. In the big box, paste this one line, replacing `MAIN_ADDRESS` with your main address:
   ```
   MAIN_ADDRESS,0.01,Mainnet test payment
   ```
3. Keep **USDC** selected. Set Reference to `Mainnet demo`.
4. Click **Pay 1 recipient** and confirm in Rabby. When it says **Paid 1 recipient**, click **Open receipt**.
5. Copy the receipt page's address (URL) from the browser bar. It looks like `https://aratass.github.io/remitsheet/?tx=0x…&chain=5042`.
6. Optional: click **Accounting CSV (EUR)** and **Print or save as PDF** to see them working.

Send us both links (deployment transaction, receipt).

**[agents]** We then:
- put the two links into the README and into SUBMISSION.md;
- push that update;
- check that the live site loads.

We also open the receipt page in Chrome to check that it shows the payment.

### 6. Submit on DoraHacks (8 min)
1. Open https://dorahacks.io/hackathon/arc-microgrants and log in or sign up.
2. Click **Submit BUIDL** (if asked, register for the hackathon first).
3. Fill the form from **SUBMISSION.md**. Every field is ready to copy:
   - name, tagline and description;
   - links: live app, GitHub, contract, receipt, deployment transaction;
   - team: solo;
   - payout wallet: your **main address**.
4. Upload `submission/logo-512.png` as the logo and `submission/cover-1280x720.png` as the cover. Add screenshots from `submission/screenshots/` if the form has a gallery.
5. Optional, 3 min: if the form has a demo video field, upload `submission/demo-local-chain.mp4` to YouTube.
   - Go to https://studio.youtube.com, click **Create** → **Upload videos**, and set visibility to **Unlisted**.
   - Paste the video link into the form.
6. Submit. You can submit only once per project, so check the links open before you press the button.

Results are announced by 21 Oct 2026. If selected, 500 USDC arrives on Arc at your main address. To cash out, send it from Rabby to your Kraken USDC deposit address on the **Arc** network.

---

### What could go wrong and what to do
- **Rabby shows a very high network fee.** Arc's fee rises when the network is busy. Wait an hour and retry; normally it is a fraction of a cent.
- **The Deploy page says the contract is already live.** Someone deployed the same code first. That is fine: it is the identical, ownerless contract at the same address. Skip to step 5.
- **"Not enough USDC".** The Kraken withdrawal has not arrived yet. Check the explorer link from step 2.
