"""User Manual of the site (Pack, Revise#427): English and Thai text of every chapter. build.py calls make()."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from tpl import build

def box(label, body, cls=""):
    return f'<div class="box {cls}"><b>{label}</b><div>{body}</div></div>'

C = []

# ---------------------------------------------------------------- 1
C.append(("ch1", "How to use this manual", "วิธีใช้คู่มือนี้", f"""
<p>This manual explains how to use the Aquarian Age Thailand Fan-site: finding cards, building decks, and playing on the Game Table. It follows the site as of version @VER.</p>
<p>It does not teach the rules of the card game. For those, open the <b>Rulebook</b> tab of the site, which holds the rules guide in Japanese and English.</p>
<h3>Where to start</h3>
<h4>I only want to look up cards</h4>
<p>Read Chapter 3.</p>
<h4>I want to build a deck</h4>
<p>Read Chapters 4 and 5. Chapter 6 shows how to keep decks in an account.</p>
<h4>I want to play</h4>
<p>Build a deck first (Chapter 4), then read Chapter 7.</p>
{box("How this manual marks things", '''<p><kbd>Export</kbd> is a button or tab on the site.</p><p><code>A3-01 0035</code> is text you type, or a card code.</p><p>A red box like this one is something you must know. A green strip is a tip.</p>''')}
<div class="tip">The site saves your decks and settings in the browser you are using. Nothing is installed, and an account is optional.</div>
""", f"""
<p>คู่มือนี้อธิบายวิธีใช้เว็บ Aquarian Age Thailand Fan-site ตั้งแต่การค้นหาการ์ด การจัดเด็ค ไปจนถึงการเล่นบน Game Table โดยอ้างอิงจากเว็บเวอร์ชัน @VER</p>
<p>คู่มือนี้ไม่ได้สอนกติกาของเกม หากต้องการอ่านกติกา ให้เปิดแท็บ <b>Rulebook</b> บนเว็บ ซึ่งมีคู่มือกติกาทั้งภาษาญี่ปุ่นและภาษาอังกฤษ</p>
<h3>ควรเริ่มอ่านจากตรงไหน</h3>
<h4>ต้องการค้นหาการ์ดอย่างเดียว</h4>
<p>อ่านบทที่ 3</p>
<h4>ต้องการจัดเด็ค</h4>
<p>อ่านบทที่ 4 และ 5 ส่วนบทที่ 6 อธิบายการเก็บเด็คไว้ในบัญชี</p>
<h4>ต้องการเล่นเกม</h4>
<p>จัดเด็คก่อน (บทที่ 4) แล้วอ่านบทที่ 7</p>
{box("สัญลักษณ์ที่ใช้ในคู่มือ", '''<p><kbd>Export</kbd> คือปุ่มหรือแท็บบนเว็บ</p><p><code>A3-01 0035</code> คือข้อความที่ต้องพิมพ์ หรือรหัสการ์ด</p><p>กรอบสีแดงแบบนี้คือเรื่องที่ต้องรู้ ส่วนแถบสีเขียวคือคำแนะนำ</p>''')}
<div class="tip">เว็บจะบันทึกเด็คและการตั้งค่าไว้ในเบราว์เซอร์ที่คุณใช้อยู่ ไม่ต้องติดตั้งอะไร และไม่จำเป็นต้องมีบัญชี</div>
"""))

# ---------------------------------------------------------------- 2
C.append(("ch2", "The site at a glance", "ภาพรวมของเว็บ", """
<p>The row of tabs under the banner leads to every part of the site. <kbd>Log in</kbd> is at the right end of the same row.</p>
<figure class="shot full"><img src="shot-home.jpg" alt="The Home page: the banner, the row of tabs, and the How to use steps" width="1280" height="800"><figcaption>The Home page. The tabs are under the banner.</figcaption></figure>
<h3>The tabs</h3>
<div class="tw"><table><tr><th>Tab</th><th>What it is for</th></tr>
<tr><td><b>Home</b></td><td>A short introduction and four steps to get started</td></tr>
<tr><td><b>Card List</b></td><td>Every card, with search and filters (8,283 cards)</td></tr>
<tr><td><b>Rulebook</b></td><td>The rules guide, in Japanese and English</td></tr>
<tr><td><b>Deck Builder</b></td><td>Build, save, import, export and print decks</td></tr>
<tr><td><b>Game Table</b></td><td>Play with your decks: alone, against a bot, or online</td></tr>
<tr><td><b>Changelog</b></td><td>What changed in each version, and the list of bug reports</td></tr></table></div>
<h3>What is saved, and where</h3>
<p>Your decks, the open tab, the filters and the view settings are kept in this browser on this device. If you use another device, or clear the browser's site data, they are not there.</p>
<p>To carry decks between devices, log in and save them to your account (Chapter 6), or export them as text and import them on the other device (Chapter 5).</p>
<div class="tip">On a phone the layout changes to one column. The same tabs and buttons are there.</div>
""", """
<p>แถวแท็บใต้แบนเนอร์พาไปยังทุกส่วนของเว็บ ปุ่ม <kbd>Log in</kbd> อยู่ด้านขวาสุดของแถวเดียวกัน</p>
<figure class="shot full"><img src="shot-home.jpg" alt="หน้า Home: แบนเนอร์ แถวแท็บ และขั้นตอนการใช้งาน" width="1280" height="800"><figcaption>หน้า Home แท็บต่าง ๆ อยู่ใต้แบนเนอร์</figcaption></figure>
<h3>แท็บต่าง ๆ</h3>
<div class="tw"><table><tr><th>แท็บ</th><th>ใช้ทำอะไร</th></tr>
<tr><td><b>Home</b></td><td>คำแนะนำสั้น ๆ และ 4 ขั้นตอนสำหรับเริ่มต้น</td></tr>
<tr><td><b>Card List</b></td><td>การ์ดทุกใบ พร้อมการค้นหาและตัวกรอง (8,283 ใบ)</td></tr>
<tr><td><b>Rulebook</b></td><td>คู่มือกติกา ภาษาญี่ปุ่นและภาษาอังกฤษ</td></tr>
<tr><td><b>Deck Builder</b></td><td>จัดเด็ค บันทึก Import Export และพิมพ์เด็ค</td></tr>
<tr><td><b>Game Table</b></td><td>เล่นด้วยเด็คของคุณ: เล่นคนเดียว เล่นกับบอท หรือเล่นออนไลน์</td></tr>
<tr><td><b>Changelog</b></td><td>สิ่งที่เปลี่ยนในแต่ละเวอร์ชัน และรายการแจ้งปัญหา</td></tr></table></div>
<h3>ข้อมูลถูกบันทึกไว้ที่ไหน</h3>
<p>เด็ค แท็บที่เปิดอยู่ ตัวกรอง และการตั้งค่าการแสดงผล ถูกเก็บไว้ในเบราว์เซอร์นี้บนอุปกรณ์นี้ หากใช้อุปกรณ์อื่น หรือล้างข้อมูลเว็บไซต์ของเบราว์เซอร์ ข้อมูลเหล่านี้จะไม่อยู่</p>
<p>หากต้องการใช้เด็คข้ามอุปกรณ์ ให้ Log in แล้วบันทึกเด็คไว้ในบัญชี (บทที่ 6) หรือ Export เป็นข้อความแล้ว Import บนอีกอุปกรณ์หนึ่ง (บทที่ 5)</p>
<div class="tip">บนมือถือ หน้าจอจะเปลี่ยนเป็นคอลัมน์เดียว แต่แท็บและปุ่มยังเหมือนเดิม</div>
"""))

# ---------------------------------------------------------------- 3
C.append(("ch3", "Card List", "Card List (รายการการ์ด)", f"""
<p>The Card List shows every card and lets you narrow the list until you find the one you want.</p>
<h3>Searching</h3>
<p>Type in the search box at the top. You can type a Japanese name, an English name, or a card code such as <code>A3-01 0035</code>.</p>
<h3>Filters</h3>
<p>The row under the search box narrows the list. Filters work together: a card is shown only when it passes all of them.</p>
<ul><li><b>All series</b>: the set the card belongs to</li><li><b>All factions</b>: the faction of the card</li><li><b>All categories</b>: Character, Break, Fast, Project or Permanent</li><li><b>Name</b>: cards with or without a Name</li><li><b>All class icons</b>: the class icons on the card</li><li><b>Skills</b>: cards that have a skill, such as Charge or Draw</li></ul>
<p><kbd>Filters &amp; Sort</kbd> opens or closes the filter area. <kbd>Inline</kbd> and <kbd>Sidebar</kbd> choose where the filters sit.</p>
<h3>Sorting</h3>
<p>The <b>Sort</b> buttons order the list by a skill value (Charge, Draw, Bind and others). <kbd>Stats / Sort</kbd> orders it by card stats. Press a button again to reverse the order.</p>
<h3>Card details</h3>
<p>Click a card to open its details: the picture, the stats, the skills and the card text in Japanese and English.</p>
{box("Report a card problem", "<p>The red <kbd>Report</kbd> button in the card details sends a note to the site owner when a card's text or behaviour is wrong. See Chapter 8.</p>")}
<div class="tip">The line under the filters shows how many cards match, for example “8,283 of 8,283 cards”.</div>
""", f"""
<p>Card List แสดงการ์ดทุกใบ และให้คุณกรองรายการจนเจอการ์ดที่ต้องการ</p>
<h3>การค้นหา</h3>
<p>พิมพ์ในช่องค้นหาด้านบน พิมพ์ได้ทั้งชื่อภาษาญี่ปุ่น ชื่อภาษาอังกฤษ หรือรหัสการ์ด เช่น <code>A3-01 0035</code></p>
<h3>ตัวกรอง</h3>
<p>แถวใต้ช่องค้นหาใช้กรองรายการ ตัวกรองทำงานร่วมกัน การ์ดจะแสดงก็ต่อเมื่อผ่านทุกตัวกรอง</p>
<ul><li><b>All series</b>: ชุดของการ์ด</li><li><b>All factions</b>: ฝ่าย (Faction) ของการ์ด</li><li><b>All categories</b>: Character, Break, Fast, Project หรือ Permanent</li><li><b>Name</b>: การ์ดที่มีหรือไม่มี Name</li><li><b>All class icons</b>: ไอคอนคลาสบนการ์ด</li><li><b>Skills</b>: การ์ดที่มีสกิล เช่น Charge หรือ Draw</li></ul>
<p>ปุ่ม <kbd>Filters &amp; Sort</kbd> ใช้เปิดหรือปิดส่วนตัวกรอง ส่วน <kbd>Inline</kbd> และ <kbd>Sidebar</kbd> ใช้เลือกตำแหน่งของตัวกรอง</p>
<h3>การเรียงลำดับ</h3>
<p>ปุ่ม <b>Sort</b> เรียงรายการตามค่าสกิล (Charge, Draw, Bind และอื่น ๆ) ส่วน <kbd>Stats / Sort</kbd> เรียงตามค่าสถานะของการ์ด กดปุ่มเดิมอีกครั้งเพื่อกลับลำดับ</p>
<h3>รายละเอียดการ์ด</h3>
<p>คลิกที่การ์ดเพื่อเปิดรายละเอียด: รูป ค่าสถานะ สกิล และข้อความการ์ดภาษาญี่ปุ่นและภาษาอังกฤษ</p>
{box("แจ้งปัญหาของการ์ด", "<p>ปุ่มสีแดง <kbd>Report</kbd> ในหน้ารายละเอียดการ์ด ใช้ส่งข้อความถึงเจ้าของเว็บเมื่อข้อความหรือการทำงานของการ์ดไม่ถูกต้อง ดูบทที่ 8</p>")}
<div class="tip">บรรทัดใต้ตัวกรองแสดงจำนวนการ์ดที่ตรงเงื่อนไข เช่น “8,283 of 8,283 cards”</div>
"""))

# ---------------------------------------------------------------- 4
C.append(("ch4", "Deck Builder", "Deck Builder (จัดเด็ค)", f"""
<p>The Deck Builder is where you put cards into a deck. The deck is saved by itself as you work.</p>
<figure class="shot full"><img src="shot-deck.jpg" alt="The Deck Builder: the toolbar, the card counter, and six empty columns" width="1280" height="800"><figcaption>The Deck Builder with an empty deck. The toolbar is the row that starts with the page and slot lists.</figcaption></figure>
<h3>Adding cards</h3>
<ol class="steps"><li>Press <kbd>Search cards</kbd>. A window opens with the same search and filters as the Card List.</li><li>Press <kbd>+</kbd> on a card to add one copy. Press <kbd>−</kbd> to remove one. The number between them is how many copies are in the deck.</li><li>Close the window. The cards are in the columns of the deck.</li></ol>
<p>A card goes to the column of its own type. Character cards are split into two columns: the deck's main factor and other factors.</p>
<h3>Arranging the deck</h3>
<ul><li>Drag a card to change its place, or drop it in another column to change its category. On a phone, press and hold before dragging.</li><li>Click a card in the deck to see its details and change the number of copies.</li><li><kbd>Fit to width</kbd> shrinks the cards to fit the screen. <kbd>Original</kbd> shows them large and lets the board scroll sideways.</li></ul>
<h3>Deck rules the site checks</h3>
{box("Two rules", "<p><b>Up to 4 cards with the same name.</b> The site counts by card name, not by card code, so a normal card and a foil of the same name share the limit.</p><p><b>50 to 60 cards in a deck.</b> Under 50, the counter is yellow and says how many are missing. From 50 to 60 it is green. At 60 no more cards can be added.</p>")}
<h3>Deck slots</h3>
<p>You have 50 deck slots, shown as 5 pages of 10. Choose the page in the first list of the toolbar and the slot in the second. Type the deck's name in the box next to them.</p>
<h3>Other buttons</h3>
<div class="tw"><table><tr><th>Button</th><th>What it does</th></tr>
<tr><td><kbd>How to use</kbd></td><td>Opens the built-in guide (in Thai)</td></tr>
<tr><td><kbd>Template</kbd></td><td>Chooses how the deck image is laid out: the full deck, or characters only</td></tr>
<tr><td><kbd>Sleeve</kbd></td><td>Sets this deck's card back for the Game Table, from an image you choose</td></tr>
<tr><td><kbd>Clear</kbd></td><td>Empties the open deck. Press it twice to confirm.</td></tr>
<tr><td><kbd>Account</kbd></td><td>Opens the Account page (Chapter 6)</td></tr></table></div>
""", f"""
<p>Deck Builder คือที่ใส่การ์ดลงในเด็ค เด็คจะถูกบันทึกเองระหว่างที่คุณจัด</p>
<figure class="shot full"><img src="shot-deck.jpg" alt="Deck Builder: แถบเครื่องมือ ตัวนับการ์ด และ 6 คอลัมน์ที่ยังว่าง" width="1280" height="800"><figcaption>Deck Builder ตอนเด็คยังว่าง แถบเครื่องมือคือแถวที่เริ่มด้วยรายการหน้าและช่องเด็ค</figcaption></figure>
<h3>การใส่การ์ด</h3>
<ol class="steps"><li>กด <kbd>Search cards</kbd> จะมีหน้าต่างเปิดขึ้น มีการค้นหาและตัวกรองแบบเดียวกับ Card List</li><li>กด <kbd>+</kbd> ที่การ์ดเพื่อเพิ่ม 1 ใบ กด <kbd>−</kbd> เพื่อเอาออก 1 ใบ ตัวเลขตรงกลางคือจำนวนใบที่อยู่ในเด็ค</li><li>ปิดหน้าต่าง การ์ดจะอยู่ในคอลัมน์ของเด็ค</li></ol>
<p>การ์ดจะไปอยู่ในคอลัมน์ตามประเภทของมันเอง การ์ด Character แบ่งเป็น 2 คอลัมน์ คือ Factor หลักของเด็ค และ Factor อื่น</p>
<h3>การจัดเรียงเด็ค</h3>
<ul><li>ลากการ์ดเพื่อเปลี่ยนตำแหน่ง หรือวางในคอลัมน์อื่นเพื่อเปลี่ยนประเภท บนมือถือให้กดค้างก่อนลาก</li><li>คลิกการ์ดในเด็คเพื่อดูรายละเอียดและเปลี่ยนจำนวนใบ</li><li><kbd>Fit to width</kbd> ย่อการ์ดให้พอดีความกว้างจอ ส่วน <kbd>Original</kbd> แสดงการ์ดขนาดใหญ่และเลื่อนซ้าย–ขวาได้</li></ul>
<h3>กฎของเด็คที่เว็บตรวจให้</h3>
{box("กฎ 2 ข้อ", "<p><b>การ์ดชื่อเดียวกันไม่เกิน 4 ใบ</b> เว็บนับตามชื่อการ์ด ไม่ใช่รหัสการ์ด ดังนั้นการ์ดธรรมดากับฟอยล์ที่ชื่อเดียวกันจะนับรวมกัน</p><p><b>เด็คมีการ์ด 50 ถึง 60 ใบ</b> ต่ำกว่า 50 ใบ ตัวนับเป็นสีเหลืองและบอกจำนวนที่ยังขาด ตั้งแต่ 50 ถึง 60 ใบเป็นสีเขียว เมื่อครบ 60 ใบจะใส่เพิ่มไม่ได้</p>")}
<h3>ช่องเก็บเด็ค (Slot)</h3>
<p>คุณมีช่องเก็บเด็ค 50 ช่อง แบ่งเป็น 5 หน้า หน้าละ 10 ช่อง เลือกหน้าจากรายการแรกของแถบเครื่องมือ และเลือกช่องจากรายการที่สอง พิมพ์ชื่อเด็คในช่องที่อยู่ถัดไป</p>
<h3>ปุ่มอื่น ๆ</h3>
<div class="tw"><table><tr><th>ปุ่ม</th><th>ทำอะไร</th></tr>
<tr><td><kbd>How to use</kbd></td><td>เปิดคู่มือที่อยู่ในเว็บ (ภาษาไทย)</td></tr>
<tr><td><kbd>Template</kbd></td><td>เลือกรูปแบบของรูปเด็ค: ทั้งเด็ค หรือเฉพาะ Character</td></tr>
<tr><td><kbd>Sleeve</kbd></td><td>ตั้งหลังการ์ดของเด็คนี้สำหรับ Game Table จากรูปที่คุณเลือก</td></tr>
<tr><td><kbd>Clear</kbd></td><td>ล้างเด็คที่เปิดอยู่ ต้องกด 2 ครั้งเพื่อยืนยัน</td></tr>
<tr><td><kbd>Account</kbd></td><td>เปิดหน้า Account (บทที่ 6)</td></tr></table></div>
"""))

# ---------------------------------------------------------------- 5
C.append(("ch5", "Import, Export and Print Preview", "Import, Export และ Print Preview", f"""
<p><kbd>Export</kbd> takes a deck out of the site as a picture, as text, or as pages to print. <kbd>Import</kbd> brings a text list back in.</p>
<h3>Export</h3>
<p>Press <kbd>Export</kbd>. At the top of the window choose <b>This deck</b> or <b>All decks</b>, then one of three formats.</p>
<h4>Image (.jpg)</h4>
<p>One picture of the whole deck, with its name and the number of cards of each type. Press <kbd>Download .jpg</kbd>, or right-click the preview and copy the image to paste it in a chat.</p>
<h4>List (text)</h4>
<p>The deck as a text list. Press <kbd>Copy</kbd> or <kbd>Download .txt</kbd>. Keep this list if you want to import the deck later.</p>
<h4>Print Preview</h4>
<p>Cards laid out at real size on A4 pages, ready to print and cut. It works for <b>This deck</b> only.</p>
{box("Print Preview needs a login", "<p>Only a logged-in player can use Print Preview. Without a login, the window shows a notice and a <kbd>Log in</kbd> button. After logging in, open Export again.</p>")}
<ol class="steps"><li>Tick the cards you want to print. All are ticked at first; <kbd>All</kbd> and <kbd>None</kbd> tick or clear every box.</li><li>Choose 300 dpi, or 200 dpi for smaller files.</li><li>Press <kbd>Make the pages</kbd>, then download one <b>.pdf</b>, or the pages as <b>.png</b>.</li></ol>
<p>Each ticked card is printed as many times as it is in the deck, at 59 × 86 mm. A page is A4 portrait with 9 cards, 1 mm apart, each with its own cut outline. The whole card picture is printed; nothing is cropped.</p>
{box("Print at real size", "<p>In the print window choose 100% or “Actual size”. “Fit to page” makes the cards smaller than 59 × 86 mm.</p>", "gold")}
<h3>Import</h3>
<ol class="steps"><li>Press <kbd>Import</kbd>.</li><li>Paste a list, or press <kbd>Choose .txt file</kbd> and pick a file you exported.</li><li>Press <kbd>Import</kbd>. The list replaces the open deck. A list of several decks fills several slots, and the site asks before it overwrites a slot that is not empty.</li></ol>
<p>You can also write a list by hand. Put the category in square brackets, then one card per line as <code>number x series code card number</code>. A line the site cannot read is skipped, and the site tells you.</p>
<p><code>[Character]</code><br><code>4 x A3-01 0035</code><br><code>[Fast]</code><br><code>3 x A3-01 0022</code></p>
""", f"""
<p><kbd>Export</kbd> นำเด็คออกจากเว็บเป็นรูปภาพ เป็นข้อความ หรือเป็นหน้ากระดาษสำหรับพิมพ์ ส่วน <kbd>Import</kbd> นำรายการข้อความกลับเข้ามา</p>
<h3>Export</h3>
<p>กด <kbd>Export</kbd> ที่ด้านบนของหน้าต่างให้เลือก <b>This deck</b> หรือ <b>All decks</b> แล้วเลือก 1 ใน 3 รูปแบบ</p>
<h4>Image (.jpg)</h4>
<p>รูปเดียวของทั้งเด็ค พร้อมชื่อเด็คและจำนวนการ์ดแต่ละประเภท กด <kbd>Download .jpg</kbd> หรือคลิกขวาที่ภาพตัวอย่างแล้วคัดลอกรูปไปวางในแชต</p>
<h4>List (text)</h4>
<p>เด็คในรูปแบบรายการข้อความ กด <kbd>Copy</kbd> หรือ <kbd>Download .txt</kbd> เก็บรายการนี้ไว้หากต้องการ Import เด็คกลับมาภายหลัง</p>
<h4>Print Preview</h4>
<p>จัดวางการ์ดขนาดจริงบนกระดาษ A4 พร้อมพิมพ์และตัด ใช้ได้กับ <b>This deck</b> เท่านั้น</p>
{box("Print Preview ต้อง Log in", "<p>เฉพาะผู้เล่นที่ Log in แล้วเท่านั้นที่ใช้ Print Preview ได้ หากยังไม่ได้ Log in หน้าต่างจะแสดงข้อความแจ้งและปุ่ม <kbd>Log in</kbd> เมื่อ Log in แล้วให้เปิด Export อีกครั้ง</p>")}
<ol class="steps"><li>ติ๊กเลือกการ์ดที่ต้องการพิมพ์ ตอนแรกจะติ๊กไว้ทุกใบ ปุ่ม <kbd>All</kbd> และ <kbd>None</kbd> ใช้ติ๊กหรือล้างทุกช่อง</li><li>เลือก 300 dpi หรือ 200 dpi หากต้องการไฟล์ที่เล็กลง</li><li>กด <kbd>Make the pages</kbd> แล้วดาวน์โหลดเป็น <b>.pdf</b> ไฟล์เดียว หรือเป็น <b>.png</b> ทีละหน้า</li></ol>
<p>การ์ดที่ติ๊กไว้แต่ละใบจะถูกพิมพ์ตามจำนวนที่อยู่ในเด็ค ขนาด 59 × 86 มม. หนึ่งหน้าเป็น A4 แนวตั้ง มีการ์ด 9 ใบ ห่างกัน 1 มม. แต่ละใบมีเส้นตัดของตัวเอง รูปการ์ดถูกพิมพ์ทั้งรูป ไม่มีการครอป</p>
{box("พิมพ์ที่ขนาดจริง", "<p>ในหน้าต่างพิมพ์ให้เลือก 100% หรือ “Actual size” หากเลือก “Fit to page” การ์ดจะเล็กกว่า 59 × 86 มม.</p>", "gold")}
<h3>Import</h3>
<ol class="steps"><li>กด <kbd>Import</kbd></li><li>วางรายการ หรือกด <kbd>Choose .txt file</kbd> แล้วเลือกไฟล์ที่ Export ไว้</li><li>กด <kbd>Import</kbd> รายการจะแทนที่เด็คที่เปิดอยู่ หากรายการมีหลายเด็คจะถูกใส่ลงหลายช่อง และเว็บจะถามก่อนเขียนทับช่องที่ไม่ว่าง</li></ol>
<p>คุณเขียนรายการเองก็ได้ ใส่ชื่อประเภทในวงเล็บเหลี่ยม แล้วตามด้วยการ์ดบรรทัดละใบในรูปแบบ <code>จำนวน x รหัสซีรีส์ เลขการ์ด</code> บรรทัดที่เว็บอ่านไม่ออกจะถูกข้าม และเว็บจะแจ้งให้ทราบ</p>
<p><code>[Character]</code><br><code>4 x A3-01 0035</code><br><code>[Fast]</code><br><code>3 x A3-01 0022</code></p>
"""))

# ---------------------------------------------------------------- 6
C.append(("ch6", "Account", "Account (บัญชีผู้เล่น)", f"""
<p>An account keeps your decks online, so you can load them on another device. It also opens Print Preview. Everything else on the site works without one.</p>
<h3>Getting an account</h3>
<ol class="steps"><li>Press <kbd>Log in</kbd> at the right of the tab row.</li><li>Press <kbd>Request an account</kbd>. Choose an ID and a password. An email address is optional.</li><li>The admin checks the request. Once it is approved, log in with the ID and the password.</li></ol>
{box("Add an email if you can", "<p><kbd>Forgot password?</kbd> works only for an account with an email address. Without one, you have to ask the admin.</p>")}
<h3>Saving and loading decks</h3>
<p>After logging in, the Account page shows <b>Save / Load decks</b>. The decks of this device and the decks of your account are shown side by side.</p>
<ul><li>The switch <b>One deck / All decks</b> chooses whether you move one slot or every slot.</li><li><b>Save</b> copies decks from this device to the account. <b>Load</b> copies them from the account to this device.</li><li>The page buttons move through the 5 pages of 10 slots.</li></ul>
<div class="tip">Saving and loading copy decks. Check which side you are overwriting before you confirm.</div>
<h3>Your profile</h3>
<p>On the Account page you can change your player name, your picture, your email address and your password. <kbd>Log out</kbd> is on the same page and in the menu under your name in the tab row.</p>
<p><kbd>← Deck Builder</kbd> at the top of the page goes back to your decks.</p>
""", f"""
<p>บัญชีใช้เก็บเด็คไว้ออนไลน์ เพื่อโหลดบนอุปกรณ์อื่นได้ และใช้เปิด Print Preview ส่วนอื่น ๆ ของเว็บใช้ได้โดยไม่ต้องมีบัญชี</p>
<h3>การขอบัญชี</h3>
<ol class="steps"><li>กด <kbd>Log in</kbd> ที่ด้านขวาของแถวแท็บ</li><li>กด <kbd>Request an account</kbd> เลือก ID และรหัสผ่าน ส่วนอีเมลจะใส่หรือไม่ก็ได้</li><li>แอดมินจะตรวจคำขอ เมื่ออนุมัติแล้ว ให้ Log in ด้วย ID และรหัสผ่านนั้น</li></ol>
{box("ควรใส่อีเมลถ้าทำได้", "<p><kbd>Forgot password?</kbd> ใช้ได้เฉพาะบัญชีที่มีอีเมล หากไม่มี ต้องติดต่อแอดมิน</p>")}
<h3>การบันทึกและโหลดเด็ค</h3>
<p>เมื่อ Log in แล้ว หน้า Account จะแสดง <b>Save / Load decks</b> เด็คของอุปกรณ์นี้และเด็คของบัญชีจะแสดงเคียงกัน</p>
<ul><li>สวิตช์ <b>One deck / All decks</b> ใช้เลือกว่าจะย้ายทีละช่องหรือทุกช่อง</li><li><b>Save</b> คัดลอกเด็คจากอุปกรณ์นี้ไปยังบัญชี ส่วน <b>Load</b> คัดลอกจากบัญชีมายังอุปกรณ์นี้</li><li>ปุ่มเลือกหน้าใช้เลื่อนดู 5 หน้า หน้าละ 10 ช่อง</li></ul>
<div class="tip">การ Save และ Load คือการคัดลอกเด็ค ตรวจให้แน่ใจว่ากำลังเขียนทับฝั่งไหนก่อนยืนยัน</div>
<h3>โปรไฟล์ของคุณ</h3>
<p>ในหน้า Account คุณเปลี่ยนชื่อผู้เล่น รูป อีเมล และรหัสผ่านได้ ปุ่ม <kbd>Log out</kbd> อยู่ในหน้าเดียวกัน และอยู่ในเมนูใต้ชื่อของคุณที่แถวแท็บ</p>
<p>ปุ่ม <kbd>← Deck Builder</kbd> ด้านบนของหน้าใช้กลับไปที่เด็คของคุณ</p>
"""))

# ---------------------------------------------------------------- 7
C.append(("ch7", "Game Table", "Game Table (โต๊ะเล่นเกม)", f"""
<p>The Game Table plays the game with your decks. It follows the turn order, checks costs and timing, and carries out card effects.</p>
<figure class="shot full"><img src="shot-tablepage.jpg" alt="The Game Table lobby: player image, game rules, Solo and Online" width="1280" height="800"><figcaption>The lobby. Choose a picture, the game rules, and how to play.</figcaption></figure>
{box("You need a deck first", "<p>The Game Table reads the deck slots of the Deck Builder on this device. With no deck, the lobby says so in red. Online, you can also paste a deck list.</p>")}
<h3>Game rules in the lobby</h3>
<div class="tw"><table><tr><th>Setting</th><th>What it changes</th></tr>
<tr><td><b>Response Timing</b></td><td>When players may respond to a declaration</td></tr>
<tr><td><b>Game Situation</b></td><td>A shared setting that one player declares for everyone; it decides which chances to respond are skipped</td></tr>
<tr><td><b>Auto-Skip</b></td><td>A phase in which you can take no action is skipped without asking you</td></tr>
<tr><td><b>Auto-Pay</b></td><td>When the power cards that can be paid equal the cost, they are paid without pressing Pay</td></tr></table></div>
<p>Each setting has a <kbd>?</kbd> that explains it on the site.</p>
<h3>Ways to play</h3>
<h4>Solo</h4>
<p>Choose Deck 1 and Deck 2 and who goes first. <kbd>Player</kbd> plays one deck alone. <kbd>Player #1 vs Player #2</kbd> lets you play both sides.</p>
<h4>With the bot</h4>
<p><kbd>Player vs Bot</kbd> plays your deck against a bot. <kbd>Bot vs Bot</kbd> lets you watch two bots.</p>
<h4>Campaign</h4>
<p>Play your deck against a prepared bot deck. Choose Easy, Medium, Hard or Hell, or <b>Random Opponent</b>. A coin toss decides who goes first. <b>Campaign Design</b> lets you propose a deck and how its bot should play.</p>
<h4>Online</h4>
<p>Type your name, choose a deck and the number of players, then press <kbd>Create a room</kbd> and give the room code to your friends. To join, type the code you were given. <kbd>Test room on this computer</kbd> opens a room between two tabs of the same browser.</p>
<h3>During a game</h3>
<p>A turn runs Draw → Active → Main → Charge → Discard. The table highlights what you may do, and greys out what you may not, with the reason.</p>
<ul><li><b>Resolve list</b>: declarations wait here. Each player passes or responds; when everyone has passed, the newest declaration resolves.</li><li><b>Player options</b> (⚙): card size, Hold and Game Situation.</li><li><b>Game options</b> (⚑): Undo and Redo for the table, Game Situation, and table rules.</li><li><b>Hand</b>: click the header to look at it; a button sorts it.</li><li><b>Replay</b>: save the game as a file. It holds hidden cards, so share it after the game.</li></ul>
{box("Not every card is automatic", "<p>Of 8,283 cards, 8,029 are carried out by the table. 108 are <b>partly</b> automatic: a clause is left to the players. 146 are <b>manual</b>: the players carry out the text themselves.</p><p><b>Card rule coverage</b>, linked at the top of the lobby, shows the status of every card.</p>", "blue")}
""", f"""
<p>Game Table ใช้เล่นเกมด้วยเด็คของคุณ ระบบจะเดินลำดับเทิร์น ตรวจ Cost และ Timing และทำเอฟเฟกต์ของการ์ดให้</p>
<figure class="shot full"><img src="shot-tablepage.jpg" alt="หน้า Lobby ของ Game Table: รูปผู้เล่น กฎของเกม Solo และ Online" width="1280" height="800"><figcaption>หน้า Lobby เลือกรูป กฎของเกม และวิธีเล่น</figcaption></figure>
{box("ต้องมีเด็คก่อน", "<p>Game Table อ่านเด็คจากช่องเก็บเด็คของ Deck Builder บนอุปกรณ์นี้ หากยังไม่มีเด็ค หน้า Lobby จะแจ้งเป็นตัวอักษรสีแดง ในโหมด Online คุณวางรายการเด็คแทนได้</p>")}
<h3>กฎของเกมในหน้า Lobby</h3>
<div class="tw"><table><tr><th>การตั้งค่า</th><th>เปลี่ยนอะไร</th></tr>
<tr><td><b>Response Timing</b></td><td>ช่วงเวลาที่ผู้เล่นตอบโต้การประกาศได้</td></tr>
<tr><td><b>Game Situation</b></td><td>การตั้งค่าร่วมที่ผู้เล่นคนหนึ่งประกาศให้ทุกคน ใช้กำหนดว่าจะข้ามโอกาสตอบโต้ช่วงไหน</td></tr>
<tr><td><b>Auto-Skip</b></td><td>เฟสที่คุณทำอะไรไม่ได้จะถูกข้ามโดยไม่ถาม</td></tr>
<tr><td><b>Auto-Pay</b></td><td>เมื่อ Power Card ที่จ่ายได้เท่ากับ Cost พอดี ระบบจะจ่ายให้โดยไม่ต้องกด Pay</td></tr></table></div>
<p>การตั้งค่าแต่ละข้อมีปุ่ม <kbd>?</kbd> ที่อธิบายไว้บนเว็บ</p>
<h3>วิธีเล่น</h3>
<h4>Solo</h4>
<p>เลือก Deck 1 และ Deck 2 และเลือกว่าใครเริ่มก่อน ปุ่ม <kbd>Player</kbd> เล่นเด็คเดียวคนเดียว ส่วน <kbd>Player #1 vs Player #2</kbd> ให้คุณเล่นทั้งสองฝั่ง</p>
<h4>เล่นกับบอท</h4>
<p><kbd>Player vs Bot</kbd> เล่นเด็คของคุณกับบอท ส่วน <kbd>Bot vs Bot</kbd> ให้คุณดูบอท 2 ตัวเล่นกัน</p>
<h4>Campaign</h4>
<p>เล่นเด็คของคุณกับเด็คบอทที่เตรียมไว้ เลือกระดับ Easy, Medium, Hard หรือ Hell หรือเลือก <b>Random Opponent</b> ระบบจะโยนเหรียญเพื่อตัดสินว่าใครเริ่มก่อน ส่วน <b>Campaign Design</b> ใช้เสนอเด็คและวิธีเล่นของบอท</p>
<h4>Online</h4>
<p>พิมพ์ชื่อ เลือกเด็คและจำนวนผู้เล่น แล้วกด <kbd>Create a room</kbd> จากนั้นส่งรหัสห้องให้เพื่อน หากต้องการเข้าร่วม ให้พิมพ์รหัสที่ได้รับ ปุ่ม <kbd>Test room on this computer</kbd> เปิดห้องระหว่าง 2 แท็บของเบราว์เซอร์เดียวกัน</p>
<h3>ระหว่างเล่น</h3>
<p>หนึ่งเทิร์นเดินตามลำดับ Draw → Active → Main → Charge → Discard โต๊ะจะไฮไลต์สิ่งที่ทำได้ และทำสีเทากับสิ่งที่ทำไม่ได้พร้อมบอกเหตุผล</p>
<ul><li><b>Resolve list</b>: การประกาศจะรออยู่ที่นี่ ผู้เล่นแต่ละคนเลือกผ่านหรือตอบโต้ เมื่อทุกคนผ่านแล้ว การประกาศล่าสุดจะถูก Resolve</li><li><b>Player options</b> (⚙): ขนาดการ์ด Hold และ Game Situation</li><li><b>Game options</b> (⚑): Undo และ Redo ของโต๊ะ Game Situation และกฎของโต๊ะ</li><li><b>Hand</b>: คลิกที่หัวข้อเพื่อดูการ์ดในมือ มีปุ่มสำหรับเรียงการ์ด</li><li><b>Replay</b>: บันทึกเกมเป็นไฟล์ ไฟล์นี้มีการ์ดที่ซ่อนอยู่ จึงควรแชร์หลังเกมจบ</li></ul>
{box("การ์ดไม่ได้อัตโนมัติทุกใบ", "<p>จากการ์ด 8,283 ใบ โต๊ะทำให้อัตโนมัติ 8,029 ใบ มี 108 ใบที่อัตโนมัติ<b>บางส่วน</b> คือมีบางประโยคที่ผู้เล่นต้องทำเอง และ 146 ใบเป็นแบบ <b>Manual</b> คือผู้เล่นทำตามข้อความการ์ดเอง</p><p>ลิงก์ <b>Card rule coverage</b> ที่ด้านบนของหน้า Lobby แสดงสถานะของการ์ดทุกใบ</p>", "blue")}
"""))

# ---------------------------------------------------------------- 8
C.append(("ch8", "Reporting a problem", "การแจ้งปัญหา", f"""
<p>If a card's text is wrong, or a card behaves wrongly on the Game Table, report it from the card itself.</p>
<ol class="steps"><li>Open the card's details, in the Card List or on the Game Table.</li><li>Press the red <kbd>Report</kbd> button.</li><li>Write what happened and what you expected, in up to 250 characters. Thai, English and Japanese are all fine.</li><li>Send it.</li></ol>
<p>The report is saved with the card's code, name, type and rule status. A report sent from the Game Table also carries the game situation at that moment.</p>
<h3>Following a report</h3>
<p>Open <kbd>Changelog</kbd> and then <b>Bug reports</b>. Each handled report has a ticket such as <code>AQ-021</code> with one of three states.</p>
<div class="tw"><table><tr><th>State</th><th>Meaning</th></tr>
<tr><td><b>Done</b></td><td>Fixed in the version shown on the ticket</td></tr>
<tr><td><b>Open</b></td><td>Not fixed yet, often because it could not be repeated</td></tr>
<tr><td><b>Closed</b></td><td>Not a bug, for example a different card with a similar name</td></tr></table></div>
<div class="tip">A good report names the two cards involved and says what the table did. A replay file from the game helps most.</div>
""", f"""
<p>หากข้อความของการ์ดผิด หรือการ์ดทำงานผิดบน Game Table ให้แจ้งจากการ์ดใบนั้นโดยตรง</p>
<ol class="steps"><li>เปิดรายละเอียดการ์ด ใน Card List หรือบน Game Table</li><li>กดปุ่มสีแดง <kbd>Report</kbd></li><li>เขียนว่าเกิดอะไรขึ้นและคาดว่าควรเป็นอย่างไร ไม่เกิน 250 ตัวอักษร ใช้ภาษาไทย อังกฤษ หรือญี่ปุ่นก็ได้</li><li>กดส่ง</li></ol>
<p>รายงานจะถูกบันทึกพร้อมรหัส ชื่อ ประเภท และสถานะกฎของการ์ด รายงานที่ส่งจาก Game Table จะมีสถานการณ์ของเกมในขณะนั้นด้วย</p>
<h3>การติดตามรายงาน</h3>
<p>เปิด <kbd>Changelog</kbd> แล้วเลือก <b>Bug reports</b> รายงานที่จัดการแล้วแต่ละรายการจะมี Ticket เช่น <code>AQ-021</code> และมี 1 ใน 3 สถานะ</p>
<div class="tw"><table><tr><th>สถานะ</th><th>ความหมาย</th></tr>
<tr><td><b>Done</b></td><td>แก้ไขแล้วในเวอร์ชันที่ระบุบน Ticket</td></tr>
<tr><td><b>Open</b></td><td>ยังไม่ได้แก้ มักเป็นเพราะทำซ้ำไม่ได้</td></tr>
<tr><td><b>Closed</b></td><td>ไม่ใช่บั๊ก เช่น เป็นการ์ดอีกใบที่ชื่อคล้ายกัน</td></tr></table></div>
<div class="tip">รายงานที่ดีควรบอกชื่อการ์ด 2 ใบที่เกี่ยวข้อง และบอกว่าโต๊ะทำอะไร ไฟล์ Replay ของเกมนั้นช่วยได้มากที่สุด</div>
"""))

# ---------------------------------------------------------------- 9
C.append(("ch9", "Questions and answers", "คำถามและคำตอบ", """
<h4>My decks are gone.</h4>
<p>Decks are kept per browser and per device. Check that you are in the same browser, and that its site data was not cleared. Decks saved to your account can be loaded again from the Account page.</p>
<h4>Card pictures do not appear.</h4>
<p>The pictures come from a separate picture site. Check your connection and reload the page. A card with no picture shows a placeholder with its code.</p>
<h4>The Print Preview button shows “Log in”.</h4>
<p>Print Preview is for logged-in players. Log in, then open Export again.</p>
<h4>My printed cards are too small.</h4>
<p>The printer scaled the page. Print again at 100% or “Actual size”.</p>
<h4>I cannot add a fifth copy of a card.</h4>
<p>A deck may hold up to 4 cards with the same name, counted across different card codes.</p>
<h4>The Game Table says there is no deck.</h4>
<p>Build a deck in the Deck Builder on this device, or load one from your account. Online, you can paste a deck list instead.</p>
<h4>A card did nothing when I played it.</h4>
<p>It may be a manual or partly automatic card. Carry out its text yourself, and report it if you think the table should have handled it.</p>
<h4>I forgot my password.</h4>
<p>Use <kbd>Forgot password?</kbd> on the login page if your account has an email address. Otherwise ask the admin.</p>
""", """
<h4>เด็คของฉันหายไป</h4>
<p>เด็คถูกเก็บแยกตามเบราว์เซอร์และอุปกรณ์ ตรวจว่าใช้เบราว์เซอร์เดิม และข้อมูลเว็บไซต์ไม่ได้ถูกล้าง เด็คที่บันทึกไว้ในบัญชีโหลดกลับมาได้จากหน้า Account</p>
<h4>รูปการ์ดไม่แสดง</h4>
<p>รูปมาจากเว็บเก็บรูปที่แยกต่างหาก ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วโหลดหน้าใหม่ การ์ดที่ไม่มีรูปจะแสดงเป็นกรอบพร้อมรหัสการ์ด</p>
<h4>ปุ่ม Print Preview แสดงคำว่า “Log in”</h4>
<p>Print Preview ใช้ได้เฉพาะผู้เล่นที่ Log in แล้ว ให้ Log in แล้วเปิด Export อีกครั้ง</p>
<h4>การ์ดที่พิมพ์ออกมาเล็กเกินไป</h4>
<p>เครื่องพิมพ์ย่อขนาดหน้ากระดาษ ให้พิมพ์ใหม่ที่ 100% หรือ “Actual size”</p>
<h4>ใส่การ์ดใบที่ 5 ไม่ได้</h4>
<p>เด็คหนึ่งใส่การ์ดชื่อเดียวกันได้ไม่เกิน 4 ใบ โดยนับรวมข้ามรหัสการ์ด</p>
<h4>Game Table แจ้งว่าไม่มีเด็ค</h4>
<p>จัดเด็คใน Deck Builder บนอุปกรณ์นี้ หรือโหลดจากบัญชี ในโหมด Online คุณวางรายการเด็คแทนได้</p>
<h4>เล่นการ์ดแล้วไม่มีอะไรเกิดขึ้น</h4>
<p>อาจเป็นการ์ดแบบ Manual หรืออัตโนมัติบางส่วน ให้ทำตามข้อความการ์ดเอง และแจ้งปัญหาหากคิดว่าโต๊ะควรทำให้</p>
<h4>ลืมรหัสผ่าน</h4>
<p>ใช้ <kbd>Forgot password?</kbd> ในหน้า Log in หากบัญชีมีอีเมล ถ้าไม่มีให้ติดต่อแอดมิน</p>
"""))

# ---------------------------------------------------------------- 10
C.append(("ch10", "Glossary", "อภิธานศัพท์", """
<div class="tw full"><table><tr><th>Word</th><th>Meaning on this site</th></tr>
<tr><td><b>Slot</b></td><td>One of the 50 places where a deck is kept</td></tr>
<tr><td><b>Category</b></td><td>The type of a card: Character, Break, Fast, Project or Permanent</td></tr>
<tr><td><b>Main factor</b></td><td>The faction that the deck's Name-level cards ask for most</td></tr>
<tr><td><b>Card code</b></td><td>The series code and number of a card, such as <code>A3-01 0035</code></td></tr>
<tr><td><b>Template</b></td><td>The layout used for the exported deck image</td></tr>
<tr><td><b>Sleeve</b></td><td>A deck's card back on the Game Table</td></tr>
<tr><td><b>Lobby</b></td><td>The first screen of the Game Table, where a game is set up</td></tr>
<tr><td><b>Room code</b></td><td>The code that lets other players join an online game</td></tr>
<tr><td><b>Resolve list</b></td><td>The list of declarations waiting to take effect</td></tr>
<tr><td><b>Hold</b></td><td>Your setting for when the table stops to let you respond</td></tr>
<tr><td><b>Automatic / Partly / Manual</b></td><td>How much of a card's text the table carries out</td></tr>
<tr><td><b>Ticket</b></td><td>The record of a handled bug report, numbered <code>AQ-…</code></td></tr>
<tr><td><b>Replay</b></td><td>A file that holds a whole game so it can be looked at again</td></tr></table></div>
""", """
<div class="tw full"><table><tr><th>คำ</th><th>ความหมายในเว็บนี้</th></tr>
<tr><td><b>Slot</b></td><td>ช่องเก็บเด็ค 1 ใน 50 ช่อง</td></tr>
<tr><td><b>Category</b></td><td>ประเภทของการ์ด: Character, Break, Fast, Project หรือ Permanent</td></tr>
<tr><td><b>Main factor</b></td><td>ฝ่ายที่การ์ดระดับ Name ของเด็คต้องการมากที่สุด</td></tr>
<tr><td><b>Card code</b></td><td>รหัสซีรีส์และเลขการ์ด เช่น <code>A3-01 0035</code></td></tr>
<tr><td><b>Template</b></td><td>รูปแบบการจัดวางของรูปเด็คที่ Export</td></tr>
<tr><td><b>Sleeve</b></td><td>หลังการ์ดที่แสดงบน Game Table</td></tr>
<tr><td><b>Lobby</b></td><td>หน้าแรกของ Game Table ที่ใช้ตั้งค่าเกม</td></tr>
<tr><td><b>Room code</b></td><td>รหัสที่ให้ผู้เล่นคนอื่นเข้าร่วมเกมออนไลน์</td></tr>
<tr><td><b>Resolve list</b></td><td>รายการการประกาศที่รอให้มีผล</td></tr>
<tr><td><b>Hold</b></td><td>การตั้งค่าของคุณว่าโต๊ะจะหยุดให้ตอบโต้เมื่อไร</td></tr>
<tr><td><b>Automatic / Partly / Manual</b></td><td>โต๊ะทำตามข้อความของการ์ดให้มากน้อยแค่ไหน</td></tr>
<tr><td><b>Ticket</b></td><td>บันทึกของรายงานปัญหาที่จัดการแล้ว มีเลข <code>AQ-…</code></td></tr>
<tr><td><b>Replay</b></td><td>ไฟล์ที่เก็บเกมทั้งเกมไว้เพื่อเปิดดูอีกครั้ง</td></tr></table></div>
"""))

def make(out, ver, date):
    """Write the User Manual page of the site (build.py: dist/…/manual.html)."""
    chapters = [(cid, te, tt, he.replace("@VER", ver), ht.replace("@VER", ver)) for cid, te, tt, he, ht in C]
    return build(out, "User Manual · Aquarian Age Thailand Fan-site", "USER MANUAL", "คู่มือการใช้งาน",
                 "Card List · Deck Builder · Account · Game Table", "Card List · Deck Builder · Account · Game Table",
                 f"Site version {ver} · {date}",
                 "A guide for players. Choose a chapter, or switch the language with the buttons at the top right.",
                 "คู่มือสำหรับผู้เล่น เลือกบทที่ต้องการ หรือเปลี่ยนภาษาด้วยปุ่มที่มุมขวาบน",
                 chapters, "AQUARIAN AGE FAN-SITE · USER MANUAL", "AQUARIAN AGE FAN-SITE · คู่มือการใช้งาน",
                 img="manual/", back=("index.html", "← Back to the site", "← กลับไปที่เว็บ"), full=True)
