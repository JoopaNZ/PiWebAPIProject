function WebApiModel(){
    var self = this;

    self.apiUrl = ko.observable('https://devdata.osisoft.com/piwebapi');
    self.response = ko.observable(undefined);
    self.servers = ko.observableArray(undefined);
    self.state = ko.observable(undefined)
    self.assetDatabases = ko.observableArray(undefined);
    self.elementToSearch = ko.observable(undefined);
    self.dataToInsert = ko.observable(undefined)
    self.start = ko.observable(undefined);
    self.end = ko.observable(undefined)
    
    self.searchResult = ko.observableArray(undefined);
    self.plotData = []
    self.currentPlots = ko.observableArray([]);
    self.debugText = ko.observable(undefined);
    self.selectedDbName = ko.observable(undefined);
    self.selectedDbId = undefined;

    self.userName = ko.observable('webapiuser')
    self.pwd = ko.observable('!try3.14webapi!')

    self.setHeader = function(xhr){
        xhr.setRequestHeader("Authorization", "Basic " + btoa(self.userName() + ':' + self.pwd()));
    };

    

    self.selectDatabase = function(db)
    {
        //Unselect currently selected db.
        for(i = 0; i < self.assetDatabases().length; i++)
        {   
            if(self.assetDatabases()[i].selected())
            {
                self.assetDatabases()[i].selected(false)
                break;
            }
             
        }
        db.selected(true)
        self.selectedDbName(db.name);
        self.selectedDbId = db.WebId;
    }

    
    //##################################################################
    //###################### DATABASE LISTING - START ##################
    // Following functions complete 2 step process to find connected
    // AssetServers and Databases on those servers
    //##################################################################
    

    
    // Find AssetServers
    // - Query uses selectedFields-parameter to reduce returned data
    self.listDatabases = function()
    {
        if(self.apiUrl() == undefined)
            return;
            
        var lastChar = self.apiUrl()[self.apiUrl().length-1];
        if(lastChar == '/')
            self.apiUrl(self.apiUrl().substring(0, self.apiUrl().length - 1))
        self.state("Getting AssetServers")
        url = self.apiUrl() + '/assetservers?selectedFields=Items.Name;Items.IsConnected;Items.Links.Databases';
        $.ajax({
            url: url,
            type: 'GET',
            dataType: 'json',
            beforeSend: self.setHeader,
        })
        . done(self.getAssetDatabases);

    }
    
    // 1. Filter out AssetServers where IsConnected = false
    // 2. Build a BATCH payload to query databases from connected servers
    // 3. Request WebId and Name for Connected servers
    self.getAssetDatabases = function(r)
    {
        var queryIds = []   //Helper array just to keep track of which AssetDatabases map to each assetserver
        var payload={};
        srvs = [];
        for(i=0; i < r.Items.length; i++)
        {
            var s = r.Items[i];
            if(s.IsConnected)
            {
                var server = {"name":s.Name, "ok":s.IsConnected }
                srvs.push(server);
                var qid = "Q"+i;
                queryIds.push({server: server, q:qid});
                payload[qid] = {"Method":"GET", "Resource": s.Links.Databases + '?selectedFields=Items.WebId;Items.Name'}
            }
        }
        self.servers(srvs);
        self.state("Listing asset databases")
        //self.state(undefined)
        $.ajax({
            url: self.apiUrl() + '/batch',
            type: 'POST',
            contentType: "application/json; charset=utf-8",
            dataType: 'json',
            data: JSON.stringify(payload),
            //success: function(r) { self.response(r) },
            //error: function() { alert('error'); },
            beforeSend: self.setHeader,
        })
        . done(function(response){
            var adbs = [];
           for(i = 0; i < queryIds.length; i++)
           {
               //Get a QueryID to identify response in BATCH
                var qid = queryIds[i].q;    
                //Check if query in batch succeeded
                if(response[qid].Status != 200)
                {
                    alert("Something went wrong");
                    continue;
                }

                var content = response[qid].Content;
                $.each(response[qid].Content.Items, function(ix, item)
                {
                    adbs.push({"name":item.Name, "WebId":item.WebId, "selected":ko.observable(false)});
                });
           }
           self.assetDatabases(adbs);
        })
    }

    //##################################################################
    //###################### DATABASE LISTING - END ####################
    //##################################################################

    //Uses BATCH controller to first search elements by name and then use results to get attributes for those elements.
    //Attribute query in batch uses RequestTemplate & ParentIds
    self.searchForElement = function(){
        var Q1 = self.apiUrl()+ '/elements/search?databaseWebId={1}&query=Name:={0}&selectedFields=Items.WebId;Items.Name;Items.Path';
        Q1 = Q1.replace('{0}', self.elementToSearch());
        Q1 = Q1.replace('{1}', self.selectedDbId);
        var payload = {
            "ElemSearch":{
                "Method":"GET",
                "Resource": Q1
            },
            "AttrList":{
                "Method":"GET",
                "ParentIds":["ElemSearch"],
                "RequestTemplate":{
                    "Resource": self.apiUrl()+ "/elements/{0}/attributes?selectedFields=Items.WebId;Items.Name;Items.Description;Items.Path;Items.Type"
                },
                "Parameters":["$.ElemSearch.Content.Items[*].WebId"]
            }
        };

        $.ajax({
            url: self.apiUrl()+ '/batch',
            type: 'POST',
            contentType: "application/json; charset=utf-8",
            dataType: 'json',
            data: JSON.stringify(payload),
            beforeSend: self.setHeader,
        })
        .done(function(response){
            //First get hold of elements matching the search criteria
            var elemResult = response["ElemSearch"]
            //Check status if everything was ok
            if(elemResult.Status != 200)
            {
                alert("Bugger, element search didn't work out");
                return;
            }
            
            var elements = elemResult.Content.Items;
            //Check first if Attribute query worked out.
            if(response["AttrList"].Status != 207)
            {
                alert("Attributes query buggered up :(");
                return;
            }
            //Find attribute results for each element and combine them into single object
            for(var i=0; i < elements.length; i++)
            {
                var attributeResult = response["AttrList"].Content.Items[i];
                if(attributeResult.Status != 200)
                {
                    alert("Attribute results for an element failed");
                    continue;
                }
                
                //Couldn't figure out how to filter attributes based on type, so I drop them off using code
                var attributeArray = $.map(attributeResult.Content.Items, function(f){
                    if(f.Type == "Double" || f.Type == "Int64")
                    {
                        //Give attributes an observable "Selected" property to indicate if attribute is plotted
                        f.selected = ko.observable(false)
                        return f;
                    }    
                });
                elements[i].attributes = attributeArray;
                elements[i].isPlotted = ko.observable(false); //Create observble which keeps track if any of the child attributes is currently plotted in UI
            }

            self.searchResult(elements)

        })
    }

    self.getPlotData = function(obj, parent)
    {
        if(obj.selected())  //Check if Attribute was already in use and user wants to remove it
        {
            //Filter selected attribute out from plotted attributes
            var filteredPlots = $.map(self.currentPlots(), function(f){
                if(obj.WebId != f.WebId)
                    return f;
            })
            self.currentPlots(filteredPlots);
            obj.selected(false)
            if(!self.checkForSelectedAttributes(parent.attributes))
            {
                parent.isPlotted(false);
            }
            //Re-render box chart
            Plotly.newPlot('plot', self.currentPlots(), {width:500, height:500});
        }
        else
        {
          
            var plotUrl = self.apiUrl()+ '/streams/'+ obj.WebId +'/plot';   //Build URL to fetch plot data from stream controller
            var hasStart = self.start() != undefined;
            var hasEnd = self.end() != undefined;
            if(hasStart || hasEnd)
            {
                plotUrl = plotUrl + '?';
                if(hasStart)
                {
                    plotUrl = plotUrl + 'startTime='+ self.start();
                    if(hasEnd)
                        plotUrl = plotUrl + '&'
                }
                
                if(hasEnd)
                    plotUrl = plotUrl + 'endTime='+ self.end();

            }
            //self.debugText(self.debugText() + obj.WebId +'<br />')
            $.ajax({
                url: plotUrl,
                type: 'GET',
                dataType: 'json',
                beforeSend: self.setHeader,
            })
            . done(function(response){
                var x = []
                var y = []
                for(i = 0; i < response.Items.length; i++)
                {
                    if(response.Items[i] == undefined)
                        continue;
                    y.push(response.Items[i].Value);
                    //x.push(response.Items[i].Timestamp);
                }
                var boxData = {
                    y, 
                    type : 'box',
                    boxmean: 'sd',
                    //name : obj.Path, //parent.Name +' '+ obj.Name,
                    name : parent.Name +' '+ obj.Name,
                    WebId : obj.WebId
                }
                self.currentPlots.push(boxData);
                obj.selected(true); //Mark Attribute selected in UI
                parent.isPlotted(true)
                Plotly.newPlot('plot', self.currentPlots(),{width:500, height:500});    
            });
            
        }
    }

    self.insert = function(){
        var actionUrl = self.apiUrl()+ '/streams/'+ self.currentPlots()[0].WebId +'/value';
        alert(actionUrl);
        return;
        var payload = {
                "Timestamp": new Date().toISOString(),
                "Good": true,
                "Questionable": false,
                "Value": self.dataToInsert()
        } 
        
        $.ajax({
            url: actionUrl,
            type: 'POST',
            contentType: "application/json; charset=utf-8",
            dataType: 'json',
            data: JSON.stringify(payload),
            beforeSend: self.setHeader,
        })
        . done(function(response){
            var foo = 'bar';
        });
    }

    //Check if given Attribute array has attributes with selected() == true
    self.checkForSelectedAttributes = function(a)
    {
        var selectedAttributes = a.filter(f => {
            return f.selected() == true;
        })
        return selectedAttributes.length > 0;
    }

    self.singleAttributeSelected = ko.pureComputed(function(){
       return (self.currentPlots().length == 1);

    })
}