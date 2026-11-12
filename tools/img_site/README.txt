Card pictures site (Cloudflare Pages) - steps
=============================================

You need on your computer: Python 3 and Node.js (both free).

1. Make the pictures (one time, about 1-3 hours, can be stopped and continued)

     pip install pillow
     python make_images.py --limit 20      <- a test with 20 pictures first
     python make_images.py                 <- all pictures

   Result: the folder "aqa-img" next to the script (about 16,500 files).
   If the last line says pictures failed, run the same command again.
   The names left in failed.txt after 2-3 runs are pictures Google Drive does not give
   (not shared / deleted). The site keeps using Google Drive for those.

2. Make a free Cloudflare account:  https://dash.cloudflare.com/sign-up
   (no payment card is needed for Pages)

3. Upload (in the folder where make_images.py is)

     npx wrangler login
     npx wrangler pages project create aqa-img --production-branch main
     npx wrangler pages deploy aqa-img --project-name aqa-img --branch main

   "wrangler login" opens the browser once; press Allow.
   If the name aqa-img is taken, use another name in both commands.
   The last command prints the address, e.g.  https://aqa-img.pages.dev
   (use this short address, not the one with letters in front like https://1a2b3c4d.aqa-img.pages.dev)

4. Check: open  https://<your address>/s/1xjqC70f0lJegTKmvDr8jQCLY3DhJzGCg.webp
   You should see the card "0001".

5. Tell Claude the address. The next site zip has it built in.
   (Or put it yourself in assets/img-config.js:   window.AA_IMG_BASE = "https://aqa-img.pages.dev";)

Later, when cards are added: take the new cards.txt, run make_images.py again
(only new pictures are downloaded) and run the "pages deploy" command again
(only new files are uploaded).
