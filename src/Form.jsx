import ListItem from "@mui/material/ListItem";
import TextField from "@mui/material/TextField";
import { Button, Input } from "@mui/material";
import { useState, useEffect } from "react";
import "./Form.css"
import * as xlsx from 'xlsx';
import fs from "fs";

export default function Form({ addTodo }) {
  const [transcript, setTranscript] = useState("");
  const [radData, setRadData] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const loadData = (e) => {
    const reader = new FileReader()
    const fileInput = document.getElementById("file-input");
    const file = fileInput.files[0];
    const files = fileInput.files;

    if (files.length > 0) {
        const file = files[0];
        reader.onload = (evt) => {
            const data = new Uint8Array(evt.target.result);
            const workbook = xlsx.read(data, {type: "array"});
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const parsedData = xlsx.utils.sheet_to_json(sheet, {header: 1});
            setRadData(parsedData);
        };
    }   
    else {
        alert("No file selected");
    }    
    reader.readAsArrayBuffer(new Blob([file]));
    setDataLoaded(true);
  }

  const handleChange = (evt) => {
    setTranscript(evt.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (transcript.length > 0) {
        let dict = {}
        let temp = JSON.parse(JSON.stringify(radData));
        for (let i = 1; i < temp.length; ++i) {
            const k = temp[i][0]; const v = temp[i][1]
            if (!dict.hasOwnProperty(k)) dict[k] = v;
        }

        const result = fetch('http://localhost:5050/analyze/', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              macros: JSON.stringify(dict),
              transcript: transcript,
            })
        })
            .then(data => console.log(data.body))
            .catch(error => console.error(error));
    } else {
        alert("Please enter your transcript before clicking Analyze!");
    }
  };
  return (
    <ListItem>
      <form onSubmit={handleSubmit} name="analyzeTranscript">
        {!dataLoaded && <Input id="file-input" type="file" accept=".xlsx, xls" onChange={loadData}/> }
        {
            dataLoaded && 
            <>
                <TextField
                    id="filled-multiline-static"
                    label="Type Your Transcript Here"
                    multiline
                    rows={6}
                    variant="filled"
                    style={{width: 800}}
                    onChange={handleChange}
                    value={transcript}
                />
                <Button variant="outlined" aria-label="analyze" type="submit" className="btn_analyze">Analyze</Button>
            </>
        }
         
      </form>
    </ListItem>
  );
}