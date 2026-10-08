import sqlite3

con = sqlite3.connect("greenhouse.db")
con.execute("ALTER TABLE plants ADD COLUMN photo_url VARCHAR(200)")
con.commit()
con.close()
print("ok")