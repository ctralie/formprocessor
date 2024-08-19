"""
This file pulls down from a survey-linked Google spreadsheet that's been published 
as a web page and extracts the payloads from it
"""

import os
import subprocess
import bs4
from bs4 import BeautifulSoup
import json

spreadsheet_id = json.load(open("config.json"))["GOOGLE_SPREADSHEET_ID"]
if os.path.exists("pubhtml"):
    os.remove("pubhtml")
subprocess.call(["wget", f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/pubhtml"])

with open("pubhtml") as fin:
    html = fin.read()

# First table in the document
idx1 = html.index("<table")
idx2 = html.index("</table>")
table = html[idx1:idx2]

soup = BeautifulSoup(table, features="html.parser")
# Everything right after thead
responses = []
s = list(next(soup.children))[1] 
for c in list(s.children)[1:]:
    children = list(c.children)
    magic = children[-1].contents
    if len(magic) > 0 and magic[0] == "magic":
        date = children[1].contents[0]
        # Drill down into the deepest child of children[2] to get the payload
        payload = ""
        node = children[2]
        if type(next(node.children)) is bs4.element.NavigableString:
            payload = str(next(node.children))
        else:
            payload = next(node.children).contents[0]
        responses.append({"date":date, "payload":payload})

json.dump(responses, open("responses.json", "w"))
